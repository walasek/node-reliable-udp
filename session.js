// node-reliable-udp
// Karol Walasek
// https://github.com/WalasPrime/node-reliable-udp
const EventEmitter = require('events');
const {DATAGRAM_CODES, PROTOCOL_ID} = require('./const');
const debug = require('debug')('reliable-udp:sessions');

const MAX_PACKET_SIZE = 1500; // MTU
const MAX_OOO_BUFFER = MAX_PACKET_SIZE*25;
const MAX_OOO_PACKETS = 500;
const MAX_SEND_BUFFER = MAX_PACKET_SIZE*25;
const MAX_SEND_PACKETS = 500;

function uint16(v){
	const buf = Buffer.allocUnsafe(2);
	buf.writeInt16BE(v);
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
		this.stalled_packets = {};
		this.stalled_packages_size = 0;
		this.recv_count = 0 >>> 0; // Force Uint32
		this.send_count = 0 >>> 0;
		this.send_buf = [];
		this.send_buf_length = 0;
		this.ooo_packets = {}; // Out-of-order
		this.ooo_packets_length = 0 >>> 0;
		this.ooo_max_id = 0;
		this.data_packets = {};
		this.data_packets_length = 0;
		this.resend_request_timeout = null;
		this.resend_request_id = 0;
		this.status_timeout = null;
	}
	close(){
		if(this.resend_request_timeout)
			clearTimeout(this.resend_request_timeout);
		if(this.status_timeout)
			clearTimeout(this.status_timeout);
	}
	/**
	 * Process incomming raw data. Emit events when complete messages are decoded.
	 * @param {Buffer} raw Raw data received from the network.
	 */
	onIncommingData(raw){
		const at = raw.readUInt16BE();
		debug(`Received ${raw.length} bytes on session with ${this.address}:${this.port}, id ${at}`);
		if(at !== this.recv_count){
			if(at < this.recv_count)return; // Too old for us
			const can_queue = this.ooo_packets_length < MAX_OOO_BUFFER && Object.keys(this.ooo_packets).length < MAX_OOO_PACKETS;
			debug(`Packet out of order, expected ${this.recv_count} but got id ${at}, ${can_queue ? 'will' : 'won\'t'} queue`);
			// TODO: Implement sending a resend request
			if(!can_queue){
				debug(`Maximum out of order packets reached, will not queue`);
			}else{
				this.ooo_packets[at] = raw;
				this.ooo_packets_length += raw.length;
				this.ooo_max_id = Math.max(at, this.ooo_max_id); // TODO: Potential remote DDOS attack if an arbitrary max is sent
				this.outOfOrderHandle(this.recv_count);
			}
			return;
		}
		// TODO: Implement messaging
		//this.recv_buf.append(raw.slice(2));
		const data = raw.slice(2);
		this.recv_count += raw.length;
		this.properPacketHandle(at);
		if(this.socket)
			this.socket.send([Buffer.from([PROTOCOL_ID, DATAGRAM_CODES.RELIABLE_UDP_DATA_ACK]), uint16(at)], this.port, this.address);
		debug(`Emitting ${data.length} of raw data`);
		/**
		 * Emitted when a packet of data has been received (properly ordered).
		 * @event StreamedUDPSession#data
		 * @type {Buffer}
		 */
		this.emit('data', data);
		const next_packet = this.ooo_packets[this.recv_count];
		if(next_packet){
			debug(`Packet ${this.recv_count} will be read from cache`);
			setImmediate(() => this.onIncommingData(next_packet));
			const len = next_packet.length;
			delete this.ooo_packets[this.recv_count];
			this.ooo_packets_length -= len;
		}
	}
	/**
	 * Handle a situation where a peer requests resending of a packet.
	 * @param {Number} id
	 */
	onResendRequest(id){
		const obj = this.data_packets[id];
		if(!obj){
			debug(`Remote end requested resend of ${id} but that packet was already forgotten, link may be unstable`);
		}else{
			debug(`Re-sending packet ${id} by remote request`);
			this.socket.send([Buffer.from([PROTOCOL_ID, DATAGRAM_CODES.RELIABLE_UDP_DATA]), obj], this.port, this.address);
		}
	}
	/**
	 * Handle a situation where the remote end has received a packet.
	 * @param {Number} id
	 */
	onDataAck(id){
		if(this.data_packets[id]){
			debug(`Remote end ACK ${id}`);
			this.data_packets_length -= this.data_packets[id].length;
			delete this.data_packets[id];
		}
	}
	/**
	 * Handle remote end's send counter. If higher than recv then request resend.
	 * @param {Number} id
	 */
	onStatus(id){
		if(id > this.recv_count){
			debug(`Remote end reported id ${id}, requesting missing parts`);
			//this.ooo_max_id = id;
			this.sendResendRequest(this.recv_count);
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
			debug(`Requesting resend of id ${id}`);
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
		return new Promise((res, rej) => {
			code = code || 0;
			const packet = this.buildOutgoingPacket(raw);
			this.data_packets_length += packet.length;
			this.data_packets[this.send_count] = packet;
			if(this.data_packets_length > MAX_SEND_BUFFER || Object.keys(this.data_packets).length > MAX_SEND_PACKETS){
				// TODO: Make this faster
				const min = Math.min(Object.keys(this.data_packets).map((v) => parseInt(v)));
				this.data_packets_length -= this.data_packets[min].length;
				delete this.data_packets[min];
			}
			debug(`Sending packet of size ${packet.length} to ${this.address}:${this.port} with id ${this.send_count}`);
			this.send_count += packet.length;
			this.socket.send([Buffer.from([PROTOCOL_ID, code]), packet], this.port, this.address, (err) => {
				if(err){
					debug(`Sending of packet failed with ${err}`);
					return rej(err);
				}
				res();
			});
			// Make sure the other peer knows about this last packet by sending a status packet
			this.statusPacketTick();
		});
	}
	/**
	 * Send generic data over this session.
	 * @param {Buffer} data
	 * @returns {Promise}
	 */
	sendBuffer(data){
		return new Promise((res, rej) => {
			this.send_buf_length += data.length;
			this.send_buf.push(data);
			debug(`Queuing ${data.length} bytes to be sent to ${this.address}:${this.port}`);
			// TODO: If buf_length exceeds maximum then stall
			setImmediate(() => this.tick());
			res();
		});
	}
	/**
	 * Sends queued outgoing packets.
	 */
	tick(){
		if(this.send_buf_length == 0)return;
		// TODO: Limit ammount of packets in case of a large queue?
		debug(`Handling transfer of ${this.send_buf_length} bytes to ${this.address}:${this.port}`)
		this.send_buf.forEach((buf) => {
			for(let i = 0; i < buf.length; i += MAX_PACKET_SIZE)
				this.sendPacket(buf.slice(i, i+MAX_PACKET_SIZE), DATAGRAM_CODES.RELIABLE_UDP_DATA);
		});
		this.send_buf = [];
		this.send_buf_length = 0;
	}
	/**
	 * Call this in case an out of order packet was encountered.
	 * @param {Number} id The id of an expected packet.
	 */
	outOfOrderHandle(id){
		if(this.resend_request_timeout)return;
		this.resend_request_timeout = setTimeout(() => {
			this.sendResendRequest(id);
			this.resend_request_timeout = null;
			this.outOfOrderHandle(id);
		}, 1);
	}
	/**
	 * Call this in case a proper packet was encountered. Cancels out of order related timeouts.
	 */
	properPacketHandle(id){
		this.resend_request_timeout = clearTimeout(this.resend_request_timeout);
		if(id < this.ooo_max_id)
			this.outOfOrderHandle(this.recv_count);
	}
	/**
	 * Notify the remote end about the sent data. Retry until the data buffer is empty.
	 */
	statusPacketTick(){
		if(this.status_timeout)return;
		if(this.data_packets_length == 0)return;
		debug(`Sending a status packet with id ${this.send_count}`);
		this.socket.send([Buffer.from([PROTOCOL_ID, DATAGRAM_CODES.RELIABLE_UDP_STATUS]), uint16(this.send_count)], this.port, this.address);
		this.status_timeout = setTimeout(() => {
			this.status_timeout = null;
			this.statusPacketTick();
		}, 1);
	}
}

module.exports = StreamedUDPSession;