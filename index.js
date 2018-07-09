// node-reliable-udp
// Karol Walasek
// https://github.com/WalasPrime/node-reliable-udp
const stun = require('stun');
const debug = {
	stun: require('debug')('reliable-udp:stun'),
};

const { STUN_BINDING_REQUEST, STUN_ATTR_XOR_MAPPED_ADDRESS } = stun.constants;

/**
 * @class
 * Allows reliable communication over UDP communication protocol.
 */
class ReliableUDPInstance {
	constructor(){

	}
	/**
	 * @description
	 * Execute the holepunching algorithm to create an address that another peer can connect to.
	 *
	 * @param {Object} [options] Pass additional options to the call
	 * @param {UDPSocket} [options.socket] A bound UDP socket to use for the communication.
	 * @param {String} [options.address=stun.LinkStyle.google.com] A STUN server address to use.
	 * @param {Number} [options.port=19302] A STUN server port to use.
	 * @returns {Promise} Resolves with an array of pair [ip, port] as a result of holepunching, or rejects with an error message
	 */
	discoverSelf(options){
		return new Promise((res, rej) => {
			options = options || {};
			const server = stun.createServer(options.socket);
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

module.exports = ReliableUDPInstance;