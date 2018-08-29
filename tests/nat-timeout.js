(async () => {
	const Socket = require('../');
	const _attempt = async () => {
		const server = new Socket({ port: 10000 });
		await server.bind();
		console.log(`${new Date()} UDP socket bound at port ${server.port}`);
		let last_port;
		while(true){
			const stun = await server.discoverSelf();
			const hole_port = stun[1];
			if(!last_port){
				console.log(`${new Date()} UDP holepunch port set to ${hole_port} (ip is ${stun[0]})`);
				last_port = hole_port;
			}

			if(last_port === hole_port){
				await new Promise(res => setTimeout(res, 60000));
			}else{
				console.log(`${new Date()} UDP holepunch port changed to ${hole_port}`);
				last_port = hole_port;
			}
		}
		//console.log(`${new Date()} finishing attempt`);
		//server.close();
	};
	while(true){
		await _attempt();
	}
})();