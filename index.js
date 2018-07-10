// node-reliable-udp
// Karol Walasek
// https://github.com/WalasPrime/node-reliable-udp
const stun = require('stun');
const EventEmitter = require('events');
const dgram = require('dgram');
const debug = {
	stun: require('debug')('reliable-udp:stun'),
	udp: require('debug')('reliable-udp:udp'),
};

const { STUN_BINDING_REQUEST, STUN_ATTR_XOR_MAPPED_ADDRESS } = stun.constants;

/**
 * @class
 * Allows handling of reliable streams of data over UDP. This class is required for both receiving and sending data. It acts as a connection manager and stream buffer. Derives from EventEmitter.
 */
class ReliableUDPSocket extends EventEmitter {
	/**
	 * @constructor
	 * @param {Object} [options] Pass options to the constructor.
	 * @param {String} [options.address=0.0.0.0] IP address to bind to, defaults to an equivalent of _listen to any addresses_.
	 * @param {Number} [options.port=0] Port number to bind to, defaults to `0` which is interpreted as a random port.
	 * @param {Socket} [options.socket=null] An already bound socket to take over.
	 */
	constructor(options){
		super();
		options = options || {};
		this.port = options.port || 0;
		this.address = options.address || '0.0.0.0';
		this.socket = options.socket || null;
	}
	/**
	 * Open a socket and bind to it. If the port was set to `0` then the `port` property will be replaced with the bound port.
	 * @returns {Promise} Resolves without a result, or rejects with an error message.
	 */
	bind(){
		return new Promise((res, rej) => {
			this.socket = dgram.createSocket('udp4');
			const handleErrors = (err) => {
				this.socket = null;
				debug.udp(`Binding to ${this.address}:${this.port} failed with ${err}`);
				rej(err);
			};
			this.socket.once('error', handleErrors);
			debug.udp(`Attempting to bind to ${this.address}:${this.port}`);
			this.socket.bind({
				port: this.port,
				address: this.address,
				exclusive: true
			}, () => {
				debug.udp(`Binding to ${this.address}:${this.port} successful`);
				this.socket.removeListener('error', handleErrors);
				this.socket.unref();
				this.port = this.socket.address().port;
				res();
			});
		});
	}
	/**
	 * Close the socket, if bound or connected.
	 * @returns {Promise}
	 */
	close(){
		return new Promise((res, rej) => {
			debug.udp(`Socket bound to ${this.address}:${this.port} now closing`);
			if(this.socket)
				return this.socket.close(res);
			res();
		});
	}
	/**
	 * Send a message to another {@link ReliableUDPSocket} peer. The message will be received as a whole on the other end.
	 * @param {String} address The IP address to send to. The other end may use holepunching to go through the NAT.
	 * @param {Number} port The port number to send to. The other end may use holepunhcing to go through the NAT.
	 * @param {Buffer} message The message to be sent.
	 */
	send(address, port, message){
		// TODO: Implement me
	}
	/**
	 * @description
	 * Execute the holepunching algorithm to create an address that another peer can connect to.
	 *
	 * @param {Object} [options] Pass additional options to the call.
	 * @param {String} [options.address=stun.l.google.com] A STUN server address to use.
	 * @param {Number} [options.port=19302] A STUN server port to use.
	 * @returns {Promise} Resolves with an array of pair [ip, port] as a result of holepunching, or rejects with an error message.
	 */
	discoverSelf(options){
		return new Promise((res, rej) => {
			options = options || {};
			const server = stun.createServer(this.socket);
			const request = stun.createMessage(STUN_BINDING_REQUEST);
			debug.stun(`STUN requesting a binding response`);

			server.once('bindingResponse', (stunMsg) => {
				const results = {
					ip: stunMsg.getAttribute(STUN_ATTR_XOR_MAPPED_ADDRESS).value.address,
					port: stunMsg.getAttribute(STUN_ATTR_XOR_MAPPED_ADDRESS).value.port
				};
				debug.stun(`STUN Binding Response: ${stunMsg.getAttribute(STUN_ATTR_XOR_MAPPED_ADDRESS).value}`);

				res([results.ip, results.port]);
				setImmediate(() => server.close());
			});

			server.send(request, options.port || 19302, options.address || 'stun.l.google.com');
		});
	}
}

module.exports = ReliableUDPSocket;