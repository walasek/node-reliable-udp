const Session = require('../session');
const Timeout = require('../timeout');
const Socket = require('./socket.mockup');

module.exports = async function(test){
	await test('Session objects emit data on receive (raw and packed)', async (t) => {
		return new Promise((res, rej) => {
			const packet = Buffer.from([0, 0, 5, 10, 15]);
			const sess = new Session();
			const packet_enc = sess.buildOutgoingPacket(Buffer.from([5, 10, 15]));
			t.equal(Buffer.compare(packet, packet_enc), 0, 'Packet encoding works properly');
			const txo = new Timeout(100, rej);
			sess.once('data', (data) => {
				if(!txo.enterGate())return;
				t.equal(data[0], 5);
				t.equal(data[1], 10);
				t.equal(data[2], 15);
				res();
			});
			sess.onIncommingData(packet);
		});
	});

	await test('Session protocol increments data counters after sending', async (t) => {
		return new Promise(async (res, rej) => {
			const socket = new Socket();
			const sess = new Session(socket);
			const d1 = Buffer.from([1, 2, 3]);
			const p1 = sess.buildOutgoingPacket(d1);
			const p1_1 = sess.buildOutgoingPacket(d1);
			t.equal(Buffer.compare(p1, p1_1), 0, 'buildOutgoingPacket does not affect state');
			await sess.sendPacket(d1);
			const p1_2 = sess.buildOutgoingPacket(d1);
			t.notEqual(Buffer.compare(p1_1, p1_2, 'sendPacket affects state'));
			t.equal(p1_2[1], 5, 'Increased id');
			res();
		});
	});
};