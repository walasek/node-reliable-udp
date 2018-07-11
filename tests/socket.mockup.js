const debug = require('debug')('reliable-udp:socket-mockup');

class SocketMockup {
	constructor(){

	}
	send(data, port, address, callback){
		debug(`send, got ${data.length} bytes`);
		if(callback)
			setImmediate(() => callback());
	}
}

module.exports = SocketMockup;