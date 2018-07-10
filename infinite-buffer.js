// node-reliable-udp
// Karol Walasek
// https://github.com/WalasPrime/node-reliable-udp

/**
 * A Buffer that can be unshifted and pushed to. Lookup of the first partition is also possible.
 * @class
 */
class InfiniteBuffer {
	constructor(){
		this.partitions = [];
		this.size = 0;
	}
	/**
	 * Add data to the buffer.
	 * @param {Buffer} data Data to be added to the buffer
	 */
	append(data){
		this.partitions.push(data);
		this.size += data.length;
	}
	/**
	 * Removes and returns a portion of the buffer from the begining.
	 * @param {Number} length
	 * @returns {Buffer}
	 */
	splice(length){
		const buf = Buffer.allocUnsafe(Math.min(length, this.size));
		let partition = 0, at = 0, splice = 0, splice_length = 0;
		while(partition < this.partitions.length && at < length){
			const p = this.partitions[partition];
			p.copy(buf, at, 0, Math.min(length-at, p.length));
			if(length >= p.length){
				// Whole partition will be removed
				splice++;
				splice_length += p.length;
			}else{
				// Only a part of this partition should be removed
				this.partitions[partition] = p.slice(length);
				splice_length += length;
			}
			at += p.length;
			partition++;
		}
		this.partitions.splice(0, splice);
		this.size -= splice_length;
		return buf;
	}
	/**
	 * Lookup the first partition buffer. Allows to decide if proper decoding of a larger chunk is possible.
	 * @returns {Buffer}
	 */
	lookup(){
		return this.partitions[0];
	}
	/**
	 * Returns the total size of the data in the buffer.
	 * @returns {Number}
	 */
	getLength(){
		return this.size;
	}
}

module.exports = InfiniteBuffer;