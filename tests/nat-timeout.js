const debug = require('debug')('reliable-udp:nat-timeout');

(async () => {
	const Socket = require('../');
	const _attempt = async () => {
		const server = new Socket({ port: 10000 });
		await server.bind();
		debug(`${new Date()} UDP socket bound at port ${server.port}`);
		let last_port;
		while(true){
			try {
				const stun = await server.discoverSelf();
				const hole_port = stun[1];
				if(!last_port){
					debug(`${new Date()} UDP holepunch port set to ${hole_port} (ip is ${stun[0]})`);
					last_port = hole_port;
				}

				if(last_port === hole_port){
					await new Promise(res => setTimeout(res, 10000));
				}else{
					debug(`${new Date()} UDP holepunch port changed to ${hole_port}`);
					last_port = hole_port;
				}
			}catch(err){
				debug(`${new Date()} iteration caught exception: ${err}`);
				await new Promise(res => setTimeout(res, 5000));
			}
		}
		//debug(`${new Date()} finishing attempt`);
		//server.close();
	};
	while(true){
		try {
			await _attempt();
		}catch(err){
			debug(`${new Date()} Exception caught at main: ${err}`);
			await new Promise(res => setTimeout(res, 5000));
		}
	}
})();