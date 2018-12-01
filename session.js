// node-reliable-udp
// Karol Walasek
// https://github.com/WalasPrime/node-reliable-udp
const EventEmitter = require('events');
const {DATAGRAM_CODES, PROTOCOL_ID} = require('./const');
const debug = require('debug')('reliable-udp:sessions');

const MAX_PACKET_SIZE = 1500; // MTU
const MAX_OOO_BUFFER = 65535;
const MAX_OOO_PACKETS = 50000;
const MAX_SEND_BUFFER = MAX_PACKET_SIZE*50;
const MAX_SEND_PACKETS = 500;
const COUNTER_LIMIT = (2 << 15) - 1;

function uint16(v){
	const buf = Buffer.allocUnsafe(2);
	buf.writeUInt16BE(v);
	return buf;
}

/**
 * @class
 * A class that turns packet-based UDP communication into a stream of properly ordered data. Derives from EventEmitter.
 */
class StreamedUDPSession extends EventEmitter {
	/**
	 * @constructor
	 * @param {Socket} socket A UDP socket
	 * @param {String} address Remote end address
	 * @param {Number} port Remote end port
	 */
	constructor(socket, address, port){
		super();
		this.address = address;
		this.socket = socket;
		this.port = port;
		this.recv_count = 0 >>> 0; // Force Uint32
		this.send_count = 0 >>> 0;
		this.closed = false;

		this.ooo_packets = [];
		this.ooo_packets_size = 0;
		this.ooo_packet_map = {};

		this.sent_packets = [];
		this.sent_packet_map = {};
		this.sent_packet_size = 0;

		this.send_buf = [];
		this.send_buf_length = 0;

		/*this.status_tick_xval = (socket ? setInterval(() => {
			this.statusPacketTick();
		}, 1000) : null);*/
	}
	close(){
		if(this.closed)return;
		if(this.status_tick_xval){
			clearInterval(this.status_tick_xval);
			this.status_tick_xval = null;
		}
		Object.values(this.sent_packet_map).forEach(p => {
			clearInterval(p.resend);
			p.reject('Socket closing')
		});
		this.closed = true;
		this.socket = null;
		/**
		 * Emited when this session is closed.
		 * @event StreamedUDPSession#close
		 */
		this.emit('close');
		this.removeAllListeners();
	}
	sendACK(id){
		if(this.socket){
			this.socket.send([Buffer.from([PROTOCOL_ID, DATAGRAM_CODES.RELIABLE_UDP_DATA_ACK]), uint16(id)], this.port, this.address);
			debug(`#${this.port} ACK id ${this.recv_count}`);
		}else{
			debug(`#${this.port} ACK cannot be sent, no socket`);
		}
	}
	/**
	 * Process incomming raw data. Emit events when complete messages are decoded.
	 * @param {Buffer} raw Raw data received from the network.
	 */
	onIncommingData(raw){
		const at = raw.readUInt16BE();
		const data = raw.slice(2);
		debug(`#${this.port} Received ${raw.length} bytes on session with ${this.address}:${this.port}, id ${at}`);
		if(at !== this.recv_count){
			if(at > this.recv_count && !this.ooo_packet_map[at]){
				// Received a part of a stream that is out of order
				if(this.ooo_packets.length < MAX_OOO_PACKETS && this.ooo_packets_size < MAX_OOO_BUFFER){
					// Can store
					this.ooo_packets.push(raw);
					this.ooo_packets_size += raw.length;
					this.ooo_packet_map[at] = true;
					debug(`#${this.port} Stored in OOO buffer`);
				}else{
					// Can't store, will have to ask for a re-send in the future
					debug(`#${this.port} Maximum out of order packets reached, will not cache`);
					this.sendResendRequest(this.recv_count);
					return;
				}
				// TODO: Set some timeouts to ask for a resend or sth
			}else{
				debug(`#${this.port} ${this.ooo_packet_map[at] ? 'Packet already in OOO buffer' : 'Packet too old'}`);
			}
			this.sendACK(at);
			return;
		}

		// Increase the counter
		this.recv_count = (this.recv_count + raw.length) % COUNTER_LIMIT;

		debug(`#${this.port} Emitting ${data.length} of raw data, next id ${this.recv_count}`);
		/**
		 * Emitted when a packet of data has been received (properly ordered).
		 * @event StreamedUDPSession#data
		 * @type {Buffer}
		 */
		this.emit('data', data);
		// TODO: If asking for a resend on an interval then clear the interval

		// Check if the next packet is in cache
		if(this.ooo_packet_map[this.recv_count]){
			for(let i = 0; i < this.ooo_packets.length; i++){
				const at = this.ooo_packets[i].readUInt16BE();
				if(at === this.recv_count){
					debug(`#${this.port} Quick-read of next packet from OOO cache`);
					const raw = this.ooo_packets[i];
					this.ooo_packets.splice(i, 1);
					delete this.ooo_packet_map[at];
					this.ooo_packets_size -= raw.length;
					// Prevent a stack overflow attack
					setImmediate(() => this.onIncommingData(raw));
					break;
				}
			}
		}
	}
	/**
	 * Handle a situation where a peer requests resending of a packet.
	 * @param {Number} id
	 */
	onResendRequest(id){
		const obj = this.sent_packet_map[id];
		if(!obj){
			debug(`#${this.port} Remote end requested resend of ${id} but that packet was already forgotten, link may be unstable`);
			//this.close();
		}else{
			debug(`#${this.port} Re-sending packet ${id} by remote request`);
			if(this.socket)
				this.socket.send([Buffer.from([PROTOCOL_ID, DATAGRAM_CODES.RELIABLE_UDP_DATA]), obj.packet], this.port, this.address);
		}
	}
	/**
	 * Handle a situation where the remote end has received a packet.
	 * @param {Number} id
	 */
	onDataAck(id){
		if(this.sent_packet_map[id]){
			debug(`#${this.port} Remote end ACK ${id}`);
			// this.sent_packets* cleanup in sendPacket
			clearInterval(this.sent_packet_map[id].resend);
			this.sent_packet_size -= this.sent_packet_map[id].packet.length;
			this.sent_packets.splice(this.sent_packets.indexOf(id), 1);
			this.sent_packet_map[id].resolve();
			delete this.sent_packet_map[id];
		}else{
			debug(`#${this.port} Unknown ACK id ${id}`);
		}
		this.statusPacketTick();
	}
	/**
	 * Handle remote end's send counter. If higher than recv then request resend.
	 * @param {Number} id
	 */
	onStatus(id){
		if(id > this.recv_count || (this.recv_count > COUNTER_LIMIT-2*MAX_PACKET_SIZE) && id < this.recv_count){
			debug(`#${this.port} Remote end reported id ${id}, requesting missing parts`);
			this.sendResendRequest(this.recv_count);
		}else{
			debug(`#${this.port} Received status ${id}, tracking ${this.recv_count}`);
		}
	}
	/**
	 * Prepare a packet with data to send over UDP.
	 * @param {Buffer} data The data to be put in the packet
	 * @param {Number} id Overwrite the packet ordering number
	 * @returns {Buffer} The data with some additional metadata
	 */
	buildOutgoingPacket(data, id){
		const packet = Buffer.allocUnsafe(data.length + 2)
		packet.writeUInt16BE(id || this.send_count);
		data.copy(packet, 2);
		return packet;
	}
	/**
	 * Prepare a resend request packet.
	 * @param {Number} id
	 */
	buildResendRequestPacket(id){
		const packet = Buffer.alloc(2);
		packet.writeUInt16BE(id)
		return packet;
	}
	/**
	 * Send a resend request.
	 * @param {Number} id
	 */
	sendResendRequest(id){
		return new Promise((res, rej) => {
			debug(`#${this.port} Requesting resend of id ${id}`);
			if(this.socket)
				this.socket.send([Buffer.from([PROTOCOL_ID, DATAGRAM_CODES.RELIABLE_UDP_RESEND_REQ]), this.buildResendRequestPacket(id)], this.port, this.address, (err) => {
					if(err){
						debug(`Failed to send a resend request`);
						return rej(err);
					}
					res();
				});
		});
	}
	/**
	 * Send a datagram over this session.
	 * @param {Buffer} raw
	 * @returns {Promise}
	 */
	sendPacket(raw, code){
		if(this.closed)return;
		return new Promise((res, rej) => {
			code = code || 0;
			const packet = this.buildOutgoingPacket(raw);
			/*if(this.sent_packet_size >= MAX_SEND_BUFFER || this.sent_packets.length > MAX_SEND_PACKETS){
				while(this.sent_packets.length > 0){
					const key = this.sent_packets.shift();
					if(this.sent_packet_map[key]){
						this.sent_packet_size -= this.sent_packet_map[key].length;
						delete this.sent_packet_map[key];
						break;
					}
				}
			}*/

			debug(`#${this.port} Sending packet of size ${packet.length} to ${this.address}:${this.port} with id ${this.send_count}`);
			const _attempt = () => {
				if(this.socket)
					this.socket.send([Buffer.from([PROTOCOL_ID, code]), packet], this.port, this.address, (err) => {
						if(err){
							debug(`Sending of packet failed with ${err}`);
							return rej(err);
						}
					});
			}
			this.sent_packet_size += packet.length;
			this.sent_packet_map[this.send_count] = {
				packet,
				resolve: res,
				//resolve: () => {},
				reject: rej,
				resend: setInterval(() => _attempt(), 70),
			};
			this.sent_packets.push(this.send_count);
			this.send_count = (this.send_count + packet.length) % COUNTER_LIMIT;
			setImmediate(() => _attempt());
			// Make sure the other peer knows about this last packet by sending a status packet
			this.statusPacketTick();
		});
	}
	/**
	 * Send generic data over this session.
	 * @param {Buffer} data
	 * @param {boolean} await_ack Use await to make sure the other end received the data.
	 * @returns {Promise}
	 */
	async sendBuffer(data, await_ack){
		// TODO: Limit ammount of packets in case of a large queue?
		debug(`#${this.port} Handling transfer of ${data.length} bytes to ${this.address}:${this.port}`)
		for(let i = 0; i < data.length; i += MAX_PACKET_SIZE){
			while(this.sent_packets.length >= 4)
				await new Promise(res => setTimeout(res, 0));
			if(await_ack){
				await this.sendPacket(data.slice(i, i+MAX_PACKET_SIZE), DATAGRAM_CODES.RELIABLE_UDP_DATA);
			}else{
				this.sendPacket(data.slice(i, i+MAX_PACKET_SIZE), DATAGRAM_CODES.RELIABLE_UDP_DATA);
			}
		}
	}
	/**
	 * Call this in case an out of order packet was encountered.
	 * @param {Number} id The id of encountered id.
	 */
	outOfOrderHandle(id){
		// TODO: Implement rate limiting
		this.sendResendRequest(this.recv_count);
	}
	/**
	 * Notify the remote end about the sent data. Retry until the data buffer is empty.
	 */
	statusPacketTick(){
		debug(`#${this.port} Sending a status packet with id ${this.send_count}`);
		if(this.socket)
			this.socket.send([Buffer.from([PROTOCOL_ID, DATAGRAM_CODES.RELIABLE_UDP_STATUS]), uint16(this.send_count)], this.port, this.address);
	}
}

module.exports = StreamedUDPSession;