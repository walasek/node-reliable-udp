// node-reliable-udp
// Karol Walasek
// https://github.com/WalasPrime/node-reliable-udp
const EventEmitter = require('events');
const XBuffer = require('./infinite-buffer');
const debug = require('debug')('reliable-udp:sessions');

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
		this.recv_buf = new XBuffer();
		this.recv_count = 0 >>> 0; // Force Uint32
		this.send_count = 0 >>> 0;
		this.send_buf = [];
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
	 * Prepare a packet to send over UDP.
	 * @param {Buffer} data The data to be put in the packet
	 * @returns {Buffer} The data with some additional metadata
	 */
	buildOutgoingPacket(data){
		const packet = Buffer.allocUnsafe(data.length + 2)
		packet.writeInt16BE(this.send_count);
		data.copy(packet, 2);
		return packet;
	}
	/**
	 * Send some data over this session.
	 * @param {Buffer} raw
	 * @returns {Promise}
	 */
	async sendPacket(raw){
		await new Promise((res, rej) => {
			const packet = this.buildOutgoingPacket(raw);
			debug(`Sending packet of size ${packet.length} to ${this.address}:${this.port} with id ${this.send_count}`);
			this.send_count += packet.length;
			this.socket.send(packet, this.port, this.address, (err) => {
				if(err){
					debug(`Sending of packet failed with ${err}`);
					return rej(err);
				}
				res();
			});
		});
	}
}

module.exports = StreamedUDPSession;