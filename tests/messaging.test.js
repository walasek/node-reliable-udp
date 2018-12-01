const Messaging = require('../messaging');
const ReliableSocket = require('../socket');
const unreliablizeSocket = require('./socket.mockup');
const Timeout = require('../timeout');

module.exports = async function(test){
	await test('Messaging allows a simple message exchange', async (t) => {
		const h1 = new ReliableSocket();
		const h2 = new ReliableSocket();
		await h1.bind();
		await h2.bind();
		const sess1 = await h1.connect('127.0.0.1', h2.port);
		await new Promise((res) => setTimeout(res, 50));
		const sess2 = h2.sessions[Object.keys(h2.sessions)[0]];
		t.ok(sess1);
		t.ok(sess2);
		const msg1 = new Messaging(sess1);
		const msg2 = new Messaging(sess2);
		await t.test('Ping pong exchange', async (t) => {
			msg1.sendMessage(Buffer.from('TEST', 'ascii'));
			const recv = await msg2.nextMessage();
			t.equal(recv.toString('ascii'), 'TEST');
			msg2.sendMessage(Buffer.from('PONG', 'ascii'));
			const recv2 = await msg1.nextMessage();
			t.equal(recv2.toString('ascii'), 'PONG');
		});
		try {
			// Throws
			await msg1.sendMessage(Buffer.alloc(msg1.max_size + 1));
			t.fail('Should have failed');
		}catch(err){
			t.ok(true, 'Too big messages throw');
		}
		await t.test('Huge messages can be exchanged', async (t) => {
			const template = Array.apply(null, Array(msg1.max_size))
				.map((v,i) => i % 256);
			msg1.sendMessage(Buffer.from(template));
			const recv = await msg2.nextMessage();
			t.equal(recv.toString('hex'), Buffer.from(template).toString('hex'), 'Long message ok');
		});
		await h1.close();
		await h2.close();
	});
	await test('Messaging across lossy links', async (t) => {
		async function _doLossyTest(loss_chance, message_size){
			const h1 = new ReliableSocket();
			const h2 = new ReliableSocket();
			try {
				await new Promise(async (res, rej) => {
					await h1.bind();
					await h2.bind();
					const sess1 = await h1.connect('127.0.0.1', h2.port);
					await new Promise((res) => setTimeout(res, 50));
					unreliablizeSocket(h1.socket, {loss: loss_chance});
					unreliablizeSocket(h2.socket, {loss: loss_chance});
					const sess2 = h2.sessions[Object.keys(h2.sessions)[0]];
					const guard = new Timeout(30100+160000*loss_chance, () => rej(`Communication failed, sess1 S/R ${sess1.recv_count}/${sess1.send_count} sess2 ${sess2.recv_count}/${sess2.send_count}`));
					const msg1 = new Messaging(sess1);
					const msg2 = new Messaging(sess2);
					sess1.on('close', () => rej('Session1 closed'));
					sess2.on('close', () => rej('Session2 closed'));
					const MESSAGES = Math.ceil(140000/4096);
					const to_recv = [];
					let recvd = 0;
					msg2.on('message', (data) => {
						if(!guard.isActive())return;
						if(data.toString('hex') === to_recv[0].toString('hex')){
							to_recv.shift();
							recvd++;
							if(recvd == MESSAGES){
								guard.dismiss();
								res();
							}
						}else{
							let at = 0;
							for(let i = 0; i < data.length; i++){
								if(data[i] != to_recv[0][i]){
									at = i;
									break;
								}
							}
							rej('Message content mismatch at '+at);
						}
					});
					for(let i = 0; i < MESSAGES; i++){
						const template = Buffer.from(Array.apply(null, Array(message_size))
							.map((v,j) => (i+j) % 256));
						to_recv.push(template);
						await msg1.sendMessage(template);
					}
				});
			}catch(err){
				console.log(err);
				throw Error(err);
			}finally{
				await new Promise(res => setTimeout(res, 3000));
				await h1.close();
				await h2.close();
			}
		}
		async function _lossyTestAttempts(loss_chance, attempts){
			await t.test('Lossy communication @ '+(loss_chance*100)+'%, '+attempts+' attempts', async (t) => {
				for(let i = 0; i < attempts; i++)
					await _doLossyTest(loss_chance, 4096);
			});
		}
		await _lossyTestAttempts(0, 1);
		await _lossyTestAttempts(0.05, 5);
		await _lossyTestAttempts(0.15, 3);
		//await _lossyTestAttempts(0.3, 10);
		//await _lossyTestAttempts(0.45, 15);
		//await _lossyTestAttempts(0.6, 5);
		//await _lossyTestAttempts(0.8, 1);
	});
}