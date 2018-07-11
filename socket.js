// node-reliable-udp
// Karol Walasek
// https://github.com/WalasPrime/node-reliable-udp
const Session = require('./session');
const Timeout = require('./timeout');
const {DATAGRAM_CODES, PROTOCOL_ID} = require('./const');
const crypto = require('crypto');
const stun = require('stun');
const EventEmitter = require('events');
const dgram = require('dgram');
const debug = {
	stun: require('debug')('reliable-udp:stun'),
	udp: require('debug')('reliable-udp:udp'),
	socket: require('debug')('reliable-udp:socket')
};

const { STUN_BINDING_REQUEST, STUN_ATTR_XOR_MAPPED_ADDRESS } = stun.constants;

/**
 * @class
 * The main class that allows establishing reliable data streams with other hosts. Serves as a sender and receiver.
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
		this.seed = Math.random()*0xFFFFFFFF >>> 0;
		debug.socket(`Session hash seed is ${this.seed}`);
		this.sessions = {};
		this.hello_queue = {};
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
			if(!this.socket)
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
				this.socket.removeListener('error', handleErrors);
				this.socket.unref();
				this.port = this.socket.address().port;
				this.socket.on('message', (data, rinfo) => this.handleDatagram(data, rinfo));
				debug.udp(`Binding to ${this.address}:${this.port} successful`);
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
	 * Send a message to another peer. The message will be received as a whole on the other end.
	 * @param {Buffer} message The message to be sent.
	 * @param {Number} port The port number to send to. The other end may use holepunhcing to go through the NAT.
	 * @param {String} address The IP address to send to. The other end may use holepunching to go through the NAT.
	 * @returns {Promise}
	 */
	send(message, port, address){
		return new Promise((res, rej) => {
			debug.udp(`Sending ${message.length} bytes to ${address}:${port}`);
			this.socket.send(message, port, address, (err) => {
				// TODO: What if a socket error?
				if(err){
					debug.udp(`Failed sending ${message.length} bytes to ${address}:${port}`);
					return rej(err);
				}
				res();
			});
		});
	}
	/**
	 * Create a unique hash for this remote host address and port.
	 * @param {Object} rinfo Remote host information.
	 * @param {String} rinfo.address Remote host IP address.
	 * @param {Number} rinfo.port Remote host port number.
	 * @returns {Buffer}
	 */
	rinfoToHash(rinfo){
		// TODO: SHA-256 might be an overkill, use something faster
		return crypto.createHash('sha256').update(`${this.seed}:${rinfo.address}:${rinfo.port}`).digest();
	}
	/**
	 * Create a Hello datagram.
	 * @returns {Buffer}
	 */
	buildHelloDatagram(){
		return Buffer.from([PROTOCOL_ID, DATAGRAM_CODES.RELIABLE_UDP_HELLO]);
	}
	/**
	 * Create a connection establish datagram
	 * @returns {Buffer}
	 */
	buildEstablishDatagram(){
		return Buffer.from([PROTOCOL_ID, DATAGRAM_CODES.RELIABLE_UDP_ESTABLISH]);
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

			const guard = new Timeout(3000, () => {});
			server.once('bindingResponse', (stunMsg) => {
				if(!guard.enterGate()){
					debug.stun(`Bidding response came back too late`);
					return;
				}
				const results = {
					ip: stunMsg.getAttribute(STUN_ATTR_XOR_MAPPED_ADDRESS).value.address,
					port: stunMsg.getAttribute(STUN_ATTR_XOR_MAPPED_ADDRESS).value.port
				};
				debug.stun(`STUN Binding Response: ${JSON.stringify(stunMsg.getAttribute(STUN_ATTR_XOR_MAPPED_ADDRESS).value)}`);

				res([results.ip, results.port]);
				setImmediate(() => server.close());
			});

			server.send(request, options.port || 19302, options.address || 'stun.l.google.com');
		});
	}
	/**
	 * Attempt to establish a session with the peer. First sends a Hello packet, expects a Hello response, then sends an Establish packet and resolves the Promise.
	 * @param {String} address
	 * @param {Number} port
	 * @param {Number} [timeout=0] If a timeout is specified then the promise will reject after that time (miliseconds).
	 * @returns {Promise(StreamedUDPSession)} Resolved when the peer has answered to a hello. Otherwise rejected after a timeout.
	 */
	connect(address, port){
		return new Promise(async (res, rej) => {
			const guard = new Timeout(3000, () => rej(`Reliable connection to ${this.address}:${this.port} timeout`));
			// 1. Send a hello packet, add host to a lightweight waiting list. (retry if needed)
			// 2. When a hello is received from this host then send an establish packet.
			// 3. Assume the connection has been established.
			const rinfo = {address, port};
			const hash = this.rinfoToHash(rinfo).toString('hex');
			this.hello_queue[hash] = rinfo;
			const hello = this.buildHelloDatagram();
			debug.udp(hello.toString('hex'));
			await this.send(hello, port, address);
			if(!guard.isActive())return;
			const self = this;
			async function _check(id){
				if(!guard.isActive())return;
				if(id == hash){
					guard.dismiss();
					await self.send(self.buildEstablishDatagram(), port, address);
					delete self.hello_queue[hash];
					self.sessions[hash] = new Session(this.socket, address, port);
					res(self.sessions[hash]);
				}else{
					self.once('expected-hello-recv', _check);
				}
			}
			_check();
		});
	}
	/**
	 * Handle incomming datagrams.
	 * @param {Buffer} datagram
	 * @param {Object} rinfo Remote host information.
	 * @param {String} rinfo.address Remote host IP address.
	 * @param {Number} rinfo.port Remote host port number.
	 */
	handleDatagram(datagram, rinfo){
		const session_id = this.rinfoToHash(rinfo).toString('hex');
		// TODO: Add firewall rules
		debug.socket(`Got ${datagram.length} bytes from ${rinfo.address}:${rinfo.port} (session ${session_id}, ${this.sessions[session_id] ? 'existing' : 'unknown'}) = ${datagram.toString('hex')}`);
		const protocol = datagram[0];
		if(protocol != PROTOCOL_ID){
			debug.socket(`Invalid protocol ${protocol}, ignoring`);
			return;
		}
		const code = datagram[1];
		switch(code){
			case DATAGRAM_CODES.RELIABLE_UDP_HELLO:
				// If unexpected hello then respond with a hello, otherwise make a session
				if(!this.hello_queue[session_id]){
					debug.socket(`Unexpected hello from ${rinfo.address}:${rinfo.port}, replying`);
					this.send(this.buildHelloDatagram(), rinfo.port, rinfo.address);
					this.hello_queue[session_id] = rinfo;
					break;
				}
				this.emit('expected-hello-recv', session_id);
				// continue to:
			case DATAGRAM_CODES.RELIABLE_UDP_ESTABLISH:
				// Remote end wants to establish a connection, allow only if helloed
				if(!this.hello_queue[session_id]){
					debug.socket(`Host ${rinfo.address}:${rinfo.port} attempted a connection without hello`);
					break;
				}
				delete this.hello_queue[session_id];
				this.sessions[session_id] = new Session(this.socket, rinfo.address, rinfo.port);
				debug.socket(`Connection with ${rinfo.address}:${rinfo.port} (${session_id}) established`);
				this.emit('new-peer', this.sessions[session_id]);
			break;
			case DATAGRAM_CODES.RELIABLE_UDP_DATA:
				if(!this.sessions[session_id]){
					debug.socket(`Unexpected data received from ${rinfo.address}:${rinfo.port}`);
					break;
				}
				this.sessions[session_id].onIncommingData(datagram.slice(2));
			break;
			case DATAGRAM_CODES.RELIABLE_UDP_RESEND_REQ:
				if(!this.sessions[session_id]){
					debug.socket(`Unexpected resend request received from ${rinfo.address}:${rinfo.port}`);
					break;
				}
				if(datagram.length == 6){
					const id = datagram.readUInt32BE(2);
					this.sessions[session_id].onResendRequest(id);
				}else{
					debug.socket(`Invalid resend datagram from ${rinfo.address}:${rinfo.port}`);
				}
			break;
			default:
				debug.socket(`Unknown datagram code ${code}, datagram dropped`);
		}
	}
	/**
	 * A generic method that allows sending data to any peer. Will connect if necessary.
	 * @param {Buffer} data
	 * @param {Number} port
	 * @param {String} address
	 * @returns {Promise}
	 */
	async sendData(data, port, address){
		const hash = this.rinfoToHash({address, port}).toString('hex');
		if(!this.sessions[hash])
			await this.connect(address, port);
		await this.sessions[hash].sendData(data);
	}
}

module.exports = ReliableUDPSocket;