const debug = require('debug')('reliable-udp:socket-mockup');

function SocketMockupDecorator(socket, options){
	options = options || {};
	options.loss = options.loss || 0;
	socket = socket || {
		send: (_1, _2, _3, cb) => {if(cb)cb();}
	};

	// TODO: Add packet shuffling
	const origin = socket.send;
	socket.send = function(){
		// Chance to fail
		if(Math.random() < options.loss){
			debug(`Oops! A send call has been supressed with ${options.loss*100}% chance`);
			return;
		}
		origin.apply(socket, arguments);
	}

	return socket;
}

module.exports = SocketMockupDecorator;