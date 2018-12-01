// node-reliable-udp
// Karol Walasek
// https://github.com/WalasPrime/node-reliable-udp
const EventEmitter = require('events');
const debug = require('debug')('reliable-udp:messaging');

const DEFAULT_MAX_SIZE = (1 << 16) - 1;
const STATE_AWAITING_FRAME = 1;
const STATE_COLLECTING_DATA = 2;
const STATE_IGNORE = 3;

/**
 * @class
 * A wrapper class that allows handling messages rather than raw data streams.
 * Works well if the messages are not too big.
 * A _message_ is basically a buffer that is sent and received as a whole (for example a valid JSON string).
 */
class MessagingOverStreams extends EventEmitter {
	/**
	 * @constructor
	 * @param {StreamedUDPSession} session
	 * @param {Number} [max_message_size=65535] Maximum message size, maximum possible value is 65535
	 */
	constructor(session, max_message_size){
		super();
		this.max_size = max_message_size || DEFAULT_MAX_SIZE;
		this.session = session;
		this.state = STATE_AWAITING_FRAME;
		this.next_message_size = 0;
		this.data_accumulation = Buffer.from([]);

		this.session.on('data', (data) => {
			this.data_accumulation = Buffer.concat([this.data_accumulation, data]);
			while(true){
				if(this.state === STATE_AWAITING_FRAME){
					if(this.data_accumulation.length >= 2){
						// Collect two bytes of message size
						this.next_message_size = this.data_accumulation.readUInt16LE();
						debug(`Retrieved a message header, message will be size ${this.next_message_size}, already have ${this.data_accumulation.length-2}`);
						if(this.next_message_size > this.max_size){
							// Possible DOS attempt
							this.state = STATE_IGNORE;
							debug(`Declared message size is too big, ignoring this session`);
							break;
						}
						this.state = STATE_COLLECTING_DATA;
						// Slice and process if got enough data
						this.data_accumulation = this.data_accumulation.slice(2);
						if(this.data_accumulation.length >= this.next_message_size){
							continue;
						}
					}
				}
				if(this.state === STATE_COLLECTING_DATA){
					if(this.data_accumulation.length >= this.next_message_size){
						// Got all the data, emit
						debug(`Collected a whole message, emiting`);
						/**
						 * Sent when a whole message has been received.
						 * @event MessagingOverStreams#message
						 * @type {Buffer}
						 */
						this.emit('message', this.data_accumulation.slice(0, this.next_message_size));
						this.data_accumulation = this.data_accumulation.slice(this.next_message_size);
						this.next_message_size = 0;
						this.state = STATE_AWAITING_FRAME;
						// If there's more data then continue processing
						if(this.data_accumulation.length > 0){
							continue;
						}
					}
				}
				break;
			}
		});
	}
	/**
	 * Send a buffer in a way so that it is received as a whole on the other end.
	 * @param {Buffer} data
	 */
	async sendMessage(data){
		if(data.length > this.max_size || data.length > DEFAULT_MAX_SIZE){
			throw Error('Cannot send a message that exceeds the maximum size '+this.max_size+' or 16-bit unsigned range '+DEFAULT_MAX_SIZE);
		}
		const header = Buffer.allocUnsafe(2);
		header.writeUInt16LE(data.length);
		await this.session.sendBuffer(Buffer.concat([header, data]));
	}
	/**
	 * Await until a next message arrives.
	 */
	async nextMessage(){
		return new Promise((res,rej) => {
			this.once('message', (data) => res(data));
		});
	}
}

module.exports = MessagingOverStreams;