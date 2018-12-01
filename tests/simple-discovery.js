const debug = require('debug')('reliable-udp:discovery');
const optimist = require('optimist')
	.usage('Start a simple discovery test instance')
	.describe('port', 'Use a specified port')
	.alias('p', 'port')
	.default('port', 10005)

	.describe('remote_ip', 'Remote agent IP address')
	.alias('ip', 'remote_ip')
	.default('remote_ip', '127.0.0.1')

	.describe('remote_port', 'Remote agent port number')
	.alias('rp', 'remote_port')
	.default('remote_port', 10005)
;
const Messaging = require('../messaging');

const argv = optimist.argv;
if(argv.h)return optimist.showHelp();

(async () => {
	const Socket = require('../');
	const server = new Socket({ port: argv.port });
	await server.bind();
	debug(`${new Date()} UDP socket bound at port ${server.port}`);
	let my_ip, my_port;
	const _refresh = async () => {
		[my_ip, my_port] = await server.discoverSelf();
	}
	await _refresh();
	setInterval(_refresh, 600000); // 10 mins
	debug(`${new Date()} discovered self at ${my_ip}:${my_port}`);

	const peer_db = [];
	const peer_messengers = [];
	function tick_peer(ip, port){
		// Note a peer is active
		const known = peer_db.filter(peer => peer.ip === ip && peer.port === port);
		if(known.length > 0){
			debug(`Noting ${ip}:${port} was active recently`);
			known[0].last_active = Date.now();
		}else{
			// New peer
			debug(`Discovered a new peer at ${ip}:${port}`);
			peer_db.push({
				ip, port, last_active: Date.now(),
			});
		}
	}

	function setup_peer(peer_messenger){
		peer_messenger.on('message', async (msg) => {
			try {
				const obj = JSON.parse(msg);
				console.log('Recv '+msg);
				tick_peer(peer_messenger.session.address, peer_messenger.session.port);
				if(obj.type === 'PEER_REQUEST'){
					const i = Math.floor(Math.random() * peer_db.length);
					await peer_messenger.sendMessage(Buffer.from(JSON.stringify({
						type: 'PEER',
						ip: peer_db[i].ip,
						port: peer_db[i].port,
					})));
					debug(`${new Date()} Discovery responded with ${JSON.stringify(peer_db[i])}`);
				}
				if(obj.type == 'PEER'){
					debug(`${new Date()} noting discovered peer ${msg}`);
					tick_peer(obj.ip, obj.port);
				}
			}catch(err){
				// Handle
				console.log(err);
			}
		});
	}

	server.on('new-peer', (peer) => {
		debug(`${new Date()} new peer connected from ${peer.address}:${peer.port}`);
		const peer_messenger = new Messaging(peer);
		peer_messengers.push(peer_messenger);
		setup_peer(peer_messenger);
		tick_peer(peer.address, peer.port);
	});

	async function tick_discover(){
		// 1. Connect to a random unconnected peer
		// 2. Ask a random connected peer for a peer addr
		// 3. Send a ping to all connected peers
		// --
		// Ad. 1
		debug('Begining Discovery tick:');
		const unconnected_peers = peer_db.filter(candidate =>
			peer_messengers.filter(msg => msg.session.address == candidate.ip && msg.session.port == candidate.port).length === 0
		);
		if(unconnected_peers.length > 0){
			const picked_candidate = unconnected_peers[Math.floor(Math.random() * unconnected_peers.length)];
			debug(`${new Date()} attempting to connect to ${picked_candidate.ip}:${picked_candidate.port}`);
			try {
				const session = await server.connect(picked_candidate.ip, picked_candidate.port);
				const msg = new Messaging(session);
				peer_messengers.push(msg);
				setup_peer(msg);
			}catch(err){
				debug(`${new Date()} peer did not respond`);
			}
		}else{
			debug(`${new Date()} no more known peers to connect to`);
		}
		// Ad. 2
		if(peer_messengers.length > 0){
			const picked_peer = peer_messengers[Math.floor(Math.random() * peer_messengers.length)];
			debug(`${new Date()} asking ${picked_peer.session.address}:${picked_peer.session.port} for a known peer`);
			picked_peer.sendMessage(Buffer.from(JSON.stringify({
				type: 'PEER_REQUEST'
			})));
		}else{
			debug(`${new Date()} no peers to ask for more peers`);
		}
		// Ad. 3
		setTimeout(() => tick_discover(), 3000);
	}

	if(argv.remote_ip !== '127.0.0.1' || (argv.port !== argv.remote_port))
		peer_db.push({ip: argv.remote_ip, port: argv.remote_port, last_active: Date.now()});
	//setTimeout(() => tick_discover(), 500);
	tick_discover();
})();