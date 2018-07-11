// node-reliable-udp
// Karol Walasek
// https://github.com/WalasPrime/node-reliable-udp
const EventEmitter = require('events');
const {DATAGRAM_CODES, PROTOCOL_ID} = require('./const');
const debug = require('debug')('reliable-udp:sessions');

const MAX_PACKET_SIZE = 1500; // MTU

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
		this.ooo_packets = 0; // Out-of-order
	}
	/**
	 * Process incomming raw data. Emit events when complete messages are decoded.
	 * @param {Buffer} raw Raw data received from the network.
	 */
	onIncommingData(raw){
		debug(`Received ${raw.length} bytes on session with ${this.address}:${this.port}`);
		const at = raw.readUInt16BE();
		if(at !== this.recv_count){
			this.ooo_packets++;
			debug(`Packet out of order, expected ${this.recv_count} but got id ${at}`);
			// TODO: Implement sending a resend request
			// TODO: Implement out of order packet queuing for improved performance
			return;
		}
		// TODO: Implement messaging
		//this.recv_buf.append(raw.slice(2));
		const data = raw.slice(2);
		this.recv_count += raw.length;
		debug(`Emitting ${data.length} of raw data`);
		/**
		 * Emitted when a packet of data has been received (properly ordered).
		 * @event StreamedUDPSession#data
		 * @type {Buffer}
		 */
		this.emit('data', data);
	}
	/**
	 * Handle a situation where a peer requests resending of a packet.
	 * @param {Number} id
	 */
	onResendRequest(id){
		// TODO: Implement me
	}
	/**
	 * Prepare a packet with data to send over UDP.
	 * @param {Buffer} data The data to be put in the packet
	 * @returns {Buffer} The data with some additional metadata
	 */
	buildOutgoingPacket(data){
		const packet = Buffer.allocUnsafe(data.length + 2)
		packet.writeUInt16BE(this.send_count);
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
			debug(`Sending packet of size ${packet.length} to ${this.address}:${this.port} with id ${this.send_count}`);
			this.send_count += packet.length;
			// TODO: Remember the packet for some time in case the other end doesn't receive it
			this.socket.send([Buffer.from([PROTOCOL_ID, code]), packet], this.port, this.address, (err) => {
				if(err){
					debug(`Sending of packet failed with ${err}`);
					return rej(err);
				}
				res();
			});
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
		// TODO: Limit ammount of packets in case of a large queue?
		debug(`Handling transfer of ${this.send_buf_length} bytes to ${this.address}:${this.port}`)
		this.send_buf.forEach((buf) => {
			for(let i = 0; i < buf.length; i += MAX_PACKET_SIZE)
				this.sendPacket(buf.slice(i, i+MAX_PACKET_SIZE), DATAGRAM_CODES.RELIABLE_UDP_DATA);
		});
		this.send_buf = [];
		this.send_buf_length = 0;
	}
}

module.exports = StreamedUDPSession;