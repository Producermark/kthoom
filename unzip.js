/*
 * unzip.js - requires binary.js
 *
 * Licensed under the MIT License
 *
 * Copyright(c) 2010 Jeff Schiller
 *
 */
importScripts('binary.js');

// this common interface encapsulates a decompressed file
// both ZipLocalFile and RarLocalFile support these two 
// two properties: filename and fileData (unpacked bytes)
function DecompressedFile(filename, fileData) {
	this.filename = filename;
	this.fileData = fileData;
}

function ProgressReport() {
	this.isDone = false;
	this.isValid = false;
	
	this.totalNumFilesInZip = 0;
	this.totalSizeInBytes = 0;
	
	this.currentFilename = "";
	this.currentFileBytesUnzipped = 0;
	this.totalBytesUnzipped = 0;
	this.message = "";
	
	this.localFiles = [];
}
var progress = new ProgressReport();

/* 
  Reference Documentation:

  * ZIP format: http://www.pkware.com/documents/casestudies/APPNOTE.TXT
  * DEFLATE format: http://tools.ietf.org/html/rfc1951

*/
var zLocalFileHeaderSignature = 0x04034b50;
var zArchiveExtraDataSignature = 0x08064b50;
var zCentralFileHeaderSignature = 0x02014b50;
var zDigitalSignatureSignature = 0x05054b50;
var zEndOfCentralDirSignature = 0x06064b50;
var zEndOfCentralDirLocatorSignature = 0x07064b50;

// takes a ByteStream and parses out the local file information
function ZipLocalFile(bstream, bDebug) {
	if (typeof bstream != typeof {} || !bstream.readNumber || typeof bstream.readNumber != typeof function(){}) {
		return null;
	}
	
	bstream.readNumber(4); // swallow signature
	this.debug = bDebug||false;
	this.isValid = false;
	this.version = bstream.readNumber(2);
	this.generalPurpose = bstream.readNumber(2);
	this.compressionMethod = bstream.readNumber(2);
	this.lastModFileTime = bstream.readNumber(2);
	this.lastModFileDate = bstream.readNumber(2);
	this.crc32 = bstream.readNumber(4);
	this.compressedSize = bstream.readNumber(4);
	this.uncompressedSize = bstream.readNumber(4);
	this.fileNameLength = bstream.readNumber(2);
	this.extraFieldLength = bstream.readNumber(2);
	
	this.filename = null;
	if (this.fileNameLength > 0) {
		this.filename = bstream.readString(this.fileNameLength);
	}
	
	if (this.debug) {
		postMessage("Zip Local File Header:");
		postMessage(" version=" + this.version);
		postMessage(" general purpose=" + this.generalPurpose);
		postMessage(" compression method=" + this.compressionMethod);
		postMessage(" last mod file time=" + this.lastModFileTime);
		postMessage(" last mod file date=" + this.lastModFileDate);
		postMessage(" crc32=" + this.crc32);
		postMessage(" compressed size=" + this.compressedSize);
		postMessage(" uncompressed size=" + this.uncompressedSize);
		postMessage(" file name length=" + this.fileNameLength);
		postMessage(" extra field length=" + this.extraFieldLength);
		postMessage(" filename = '" + this.filename + "'");
	}
	
	this.extraField = null;
	if (this.extraFieldLength > 0) {
		this.extraField = bstream.readString(this.extraFieldLength);
	}
	
	// read in the compressed data
	this.fileData = null;
	if (this.compressedSize > 0) {
		this.fileData = bstream.readString(this.compressedSize);
	}
	
	// TODO: deal with data descriptor if present (we currently assume no data descriptor!)
	// "This descriptor exists only if bit 3 of the general purpose bit flag is set"
	// But how do you figure out how big the file data is if you don't know the compressedSize
	// from the header?!?
	if ((this.generalPurpose & BIT[3]) != 0) {
		this.crc32 = bstream.readNumber(4);
		this.compressedSize = bstream.readNumber(4);
		this.uncompressedSize = bstream.readNumber(4);
	}
};

// determine what kind of compressed data we have and decompress
ZipLocalFile.prototype.unzip = function() {
		// Zip Version 1.0, no compression (store only)
		if (this.version == 10 && this.compressionMethod == 0) {
			if (this.debug)
				postMessage("ZIP v1.0, store only: " + this.filename + " (" + this.compressedSize + " bytes)");
			progress.currentFileBytesUnzipped = this.compressedSize;
			progress.totalBytesUnzipped += this.compressedSize;
			this.isValid = true;
		}
		// version == 20, compression method == 8 (DEFLATE)
		else if (this.version == 20 && this.compressionMethod == 8) {
			if (this.debug || true)
				postMessage("ZIP v2.0, DEFLATE: " + this.filename + " (" + this.compressedSize + " bytes)");
			this.fileData = inflate(this.fileData, this.uncompressedSize);
			this.isValid = true;
		}
		else {
			postMessage("UNSUPPORTED VERSION/FORMAT: ZIP v" + this.version + ", compression method=" + this.compressionMethod + ": " + this.filename + " (" + this.compressedSize + " bytes)");
			this.isValid = false;
			this.fileData = null;
		}
};

// helper function that will create a binary stream out of an array of numbers
// bytes must be an array and contain numbers, each varying from 0-255
var createBinaryString = function(bytes) {
	if (typeof bytes != typeof []) {
		return null;
	}
	var i = bytes.length,
		bstr = new Array(i);
	while (i--)
		bstr[i] = String.fromCharCode(bytes[i]);
	return bstr.join('');
};

// shows a number as its binary representation (8 => "1000")
// len is the number of bits, if num=8 and len=6, this function would return "001000"
var binaryValueToString = function(num, len) {
	if (typeof num != typeof 1) {
		throw ("Error! Non-number sent to binaryValueToString: " + num);
		return null;
	}
	var len = len || 0,
		str = "";
	do {
		// get least-significant bit
		var bit = (num & 0x1);
		// insert it left into the string
		str = (bit ? "1" : "0") + str;
		// shift it one bit right
		num >>= 1;
		--len;
	} while (num != 0 || len > 0);
	
	return str;
};

// shows a byte value as its hex representation
var nibble = "0123456789ABCDEF";
var byteValueToHexString = function(num) {
	return nibble[num>>4] + nibble[num&0xF];
}
var twoByteValueToHexString = function(num) {
	return nibble[(num>>12)&0xF] + nibble[(num>>8)&0xF] + nibble[(num>>4)&0xF] + nibble[num&0xF];
}

// Takes a binary string of a zip file in
// returns null on error
// returns an array of DecompressedFile objects on success
function unzip(bstr, bDebug) {
	var bstream = new ByteStream(bstr);
	
	// detect local file header signature or return null
	if (bstream.peekNumber(4) == zLocalFileHeaderSignature) {
		var localFiles = [];
		// loop until we don't see any more local files
		while (bstream.peekNumber(4) == zLocalFileHeaderSignature) {
			var oneLocalFile = new ZipLocalFile(bstream, bDebug);
			// this should strip out directories/folders
			if (oneLocalFile && oneLocalFile.uncompressedSize > 0) {
				localFiles.push(oneLocalFile);
				progress.totalNumFilesInZip++;
				progress.totalSizeInBytes += oneLocalFile.uncompressedSize;
			}
		}
		progress.totalNumFilesInZip = localFiles.length;
		
		// got all local files, now sort them
		localFiles.sort(function(a,b) {
			// extract the number at the end of both filenames
			var aname = a.filename;
			var bname = b.filename;
			var aindex = aname.length, bindex = bname.length;

			// Find the last number character from the back of the filename.
			while (aname[aindex-1] < '0' || aname[aindex-1] > '9') --aindex;
			while (bname[bindex-1] < '0' || bname[bindex-1] > '9') --bindex;

			// Find the first number character from the back of the filename
			while (aname[aindex-1] >= '0' && aname[aindex-1] <= '9') --aindex;
			while (bname[bindex-1] >= '0' && bname[bindex-1] <= '9') --bindex;
			
			// parse them into numbers and return comparison
			var anum = parseInt(aname.substr(aindex), 10),
				bnum = parseInt(bname.substr(bindex), 10);
			return anum - bnum;
		});
		
		// archive extra data record
		if (bstream.peekNumber(4) == zArchiveExtraDataSignature) {
			postMessage(" Found an Archive Extra Data Signature");
			// skipping this record for now
			bstream.readNumber(4);
			var archiveExtraFieldLength = bstream.readNumber(4);
			bstream.readString(archiveExtraFieldLength);
		}
		
		// central directory structure
		// TODO: handle the rest of the structures (Zip64 stuff)
		if (bstream.peekNumber(4) == zCentralFileHeaderSignature) {
			postMessage(" Found a Central File Header");
			// read all file headers
			while (bstream.peekNumber(4) == zCentralFileHeaderSignature) {
				bstream.readNumber(4); // signature
				bstream.readNumber(2); // version made by
				bstream.readNumber(2); // version needed to extract
				bstream.readNumber(2); // general purpose bit flag
				bstream.readNumber(2); // compression method
				bstream.readNumber(2); // last mod file time
				bstream.readNumber(2); // last mod file date
				bstream.readNumber(4); // crc32
				bstream.readNumber(4); // compressed size
				bstream.readNumber(4); // uncompressed size
				var fileNameLength = bstream.readNumber(2); // file name length
				var extraFieldLength = bstream.readNumber(2); // extra field length
				var fileCommentLength = bstream.readNumber(2); // file comment length
				bstream.readNumber(2); // disk number start
				bstream.readNumber(2); // internal file attributes
				bstream.readNumber(4); // external file attributes
				bstream.readNumber(4); // relative offset of local header
				
				bstream.readString(fileNameLength); // file name
				bstream.readString(extraFieldLength); // extra field
				bstream.readString(fileCommentLength); // file comment				
			}
		}
		
		// digital signature
		if (bstream.peekNumber(4) == zDigitalSignatureSignature) {
			postMessage(" Found a Digital Signature");
			bstream.readNumber(4);
			var sizeOfSignature = bstream.readNumber(2);
			bstream.readString(sizeOfSignature); // digital signature data
		}
		
		progress.isValid = true;
		
		// report # files and total length
		if (localFiles.length > 0) {
			postMessage(progress);
		}
		
		// now do the unzipping of each file
		for (var i = 0; i < localFiles.length; ++i) {
			var localfile = localFiles[i];
			
			// update progress 
			progress.currentFilename = localfile.filename;
			progress.currentFileBytesUnzipped = 0;
			
			// actually do the unzipping
			localfile.unzip();
			
			if (progress.isValid) {
				progress.localFiles.push(localfile);
			}
		}
		progress.isDone = true;
	}
	else { // check for RAR
		unrar(bstr, bDebug);
	}
	return progress;
}

// returns a table of Huffman codes 
// each entry's index is its code and its value is a JavaScript object 
// containing {length: 6, symbol: X}
function getHuffmanCodes(bitLengths) {
	// ensure bitLengths is an array containing at least one element
	if (typeof bitLengths != typeof [] || bitLengths.length < 1) {
		throw "Error! getHuffmanCodes() called with an invalid array";
		return null;
	}
	
	// Reference: http://tools.ietf.org/html/rfc1951#page-8
	var numLengths = bitLengths.length,
		bl_count = [],
		MAX_BITS = 1;
	
	// Step 1: count up how many codes of each length we have
	for (var i = 0; i < numLengths; ++i) {
		var length = bitLengths[i];
		// test to ensure each bit length is a positive, non-zero number
		if (typeof length != typeof 1 || length < 0) {
			throw ("bitLengths contained an invalid number in getHuffmanCodes(): " + length + " of type " + (typeof length));
			return null;
		}
		// increment the appropriate bitlength count
		if (bl_count[length] == undefined) bl_count[length] = 0;
		// a length of zero means this symbol is not participating in the huffman coding
		if (length > 0) bl_count[length]++;
		
		if (length > MAX_BITS) MAX_BITS = length;
	}
	
	// Step 2: Find the numerical value of the smallest code for each code length
	var next_code = [],
		code = 0;
	for (var bits = 1; bits <= MAX_BITS; ++bits) {
		var length = bits-1;
		// ensure undefined lengths are zero
		if (bl_count[length] == undefined) bl_count[length] = 0;
		code = (code + bl_count[bits-1]) << 1;
		next_code[bits] = code;
	}
	
	// Step 3: Assign numerical values to all codes
	var table = {}, tableLength = 0;
	for (var n = 0; n < numLengths; ++n) {
		var len = bitLengths[n];
		if (len != 0) {
			table[next_code[len]] = { length: len, symbol: n }; //, bitstring: binaryValueToString(next_code[len],len) };
			tableLength++;
			next_code[len]++;
		}
	}
	table.maxLength = tableLength;
	
	return table;
}

/*
	 The Huffman codes for the two alphabets are fixed, and are not
	 represented explicitly in the data.  The Huffman code lengths
	 for the literal/length alphabet are:
	
			   Lit Value    Bits        Codes
			   ---------    ----        -----
				 0 - 143     8          00110000 through
										10111111
			   144 - 255     9          110010000 through
										111111111
			   256 - 279     7          0000000 through
										0010111
			   280 - 287     8          11000000 through
										11000111
*/
// fixed Huffman codes go from 7-9 bits, so we need an array whose index can hold up to 9 bits
var fixedHCtoLiteral = null;
var fixedHCtoDistance = null;
function getFixedLiteralTable() {
	// create once
	if (!fixedHCtoLiteral) {
		var bitlengths = new Array(288);
		for (var i = 0; i <= 143; ++i) bitlengths[i] = 8;
		for (i = 144; i <= 255; ++i) bitlengths[i] = 9;
		for (i = 256; i <= 279; ++i) bitlengths[i] = 7;
		for (i = 280; i <= 287; ++i) bitlengths[i] = 8;
		
		// get huffman code table
		fixedHCtoLiteral = getHuffmanCodes(bitlengths);
	}
	return fixedHCtoLiteral;
}
function getFixedDistanceTable() {
	// create once
	if (!fixedHCtoDistance) {
		var bitlengths = new Array(32);
		for (var i = 0; i < 32; ++i) { bitlengths[i] = 5; }
		
		// get huffman code table
		fixedHCtoDistance = getHuffmanCodes(bitlengths);
	}
	return fixedHCtoDistance;
}

// extract one bit at a time until we find a matching Huffman Code
// then return that symbol
function decodeSymbol(bstream, hcTable) {
	var code = 0, len = 0;
	var match = false;
	
	// loop until we match
	for (;;) {
		// read in next bit
		code = (code<<1) | bstream.readBits(1);
		++len;
		
		// check against Huffman Code table and break if found
		if (hcTable.hasOwnProperty(code) && hcTable[code].length == len) {
			break;
		}
		if (len > hcTable.maxLength) {
			throw ("Bit stream out of sync, didn't find a Huffman Code, length was " + len + 
					" and table only max code length of " + hcTable.maxLength);
			break;
		}
	}
	return hcTable[code].symbol;
}

function Buffer(numBytes) {
	if (typeof numBytes != typeof 1 || numBytes <= 0) {
		throw "Error! Buffer initialized with '" + numBytes + "'";
	}
	this.data = new Array(numBytes);
	this.ptr = 0;
	
	this.insertByte = function(b) {
		// TODO: throw if byte is invalid?
		this.data[this.ptr++] = b;
	};
	
	this.insertBytes = function(bytes) {
		// TODO: throw if bytes is invalid?
		var d = this.data, len = bytes.length;
		for (var i = 0; i < len; ++i) {
			d[this.ptr++] = bytes[i];
		}
	};
}

var CodeLengthCodeOrder = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
	/*
		 Extra               Extra               Extra
	Code Bits Length(s) Code Bits Lengths   Code Bits Length(s)
	---- ---- ------     ---- ---- -------   ---- ---- -------
	 257   0     3       267   1   15,16     277   4   67-82
	 258   0     4       268   1   17,18     278   4   83-98
	 259   0     5       269   2   19-22     279   4   99-114
	 260   0     6       270   2   23-26     280   4  115-130
	 261   0     7       271   2   27-30     281   5  131-162
	 262   0     8       272   2   31-34     282   5  163-194
	 263   0     9       273   3   35-42     283   5  195-226
	 264   0    10       274   3   43-50     284   5  227-257
	 265   1  11,12      275   3   51-58     285   0    258
	 266   1  13,14      276   3   59-66
	 
	*/
var LengthLookupTable = [
		[0,3], [0,4], [0,5], [0,6],
		[0,7], [0,8], [0,9], [0,10],
		[1,11], [1,13], [1,15], [1,17],
		[2,19], [2,23], [2,27], [2,31],
		[3,35], [3,43], [3,51], [3,59],
		[4,67], [4,83], [4,99], [4,115],
		[5,131], [5,163], [5,195], [5,227],
		[0,258]
];
	/*
		  Extra           Extra                Extra
	 Code Bits Dist  Code Bits   Dist     Code Bits Distance
	 ---- ---- ----  ---- ----  ------    ---- ---- --------
	   0   0    1     10   4     33-48    20    9   1025-1536
	   1   0    2     11   4     49-64    21    9   1537-2048
	   2   0    3     12   5     65-96    22   10   2049-3072
	   3   0    4     13   5     97-128   23   10   3073-4096
	   4   1   5,6    14   6    129-192   24   11   4097-6144
	   5   1   7,8    15   6    193-256   25   11   6145-8192
	   6   2   9-12   16   7    257-384   26   12  8193-12288
	   7   2  13-16   17   7    385-512   27   12 12289-16384
	   8   3  17-24   18   8    513-768   28   13 16385-24576
	   9   3  25-32   19   8   769-1024   29   13 24577-32768
	*/
var DistLookupTable = [
	[0,1], [0,2], [0,3], [0,4],
	[1,5], [1,7],
	[2,9], [2,13],
	[3,17], [3,25],
	[4,33], [4,49],
	[5,65], [5,97],
	[6,129], [6,193],
	[7,257], [7,385],
	[8,513], [8,769],
	[9,1025], [9,1537],
	[10,2049], [10,3073],
	[11,4097], [11,6145],
	[12,8193], [12,12289],
	[13,16385], [13,24577]
];

function inflateBlockData(bstream, hcLiteralTable, hcDistanceTable, buffer) {
	/*
		  loop (until end of block code recognized)
			 decode literal/length value from input stream
			 if value < 256
				copy value (literal byte) to output stream
			 otherwise
				if value = end of block (256)
				   break from loop
				otherwise (value = 257..285)
				   decode distance from input stream

				   move backwards distance bytes in the output
				   stream, and copy length bytes from this
				   position to the output stream.
	*/
	var numSymbols = 0, blockSize = 0;
	for (;;) {
		var symbol = decodeSymbol(bstream, hcLiteralTable);
		++numSymbols;
		if (symbol < 256) {
			// copy literal byte to output
			buffer.insertByte(String.fromCharCode(symbol));
			blockSize++;
		}
		else {
			// end of block reached
			if (symbol == 256) {
				break;
			}
			else {
				var lengthLookup = LengthLookupTable[symbol-257],
					length = lengthLookup[1] + bstream.readBits(lengthLookup[0]),
					distLookup = DistLookupTable[decodeSymbol(bstream, hcDistanceTable)],
					distance = distLookup[1] + bstream.readBits(distLookup[0]);

				// now apply length and distance appropriately and copy to output

				// TODO: check that backward distance < data.length?
				
				// http://tools.ietf.org/html/rfc1951#page-11
				// "Note also that the referenced string may overlap the current
				//  position; for example, if the last 2 bytes decoded have values
				//  X and Y, a string reference with <length = 5, distance = 2>
				//  adds X,Y,X,Y,X to the output stream."
				// 
				// loop for each character
				var ch = buffer.ptr - distance;
				var data = buffer.data;
				blockSize += length;
				while (length--) {
					buffer.insertByte(data[ch++]);
				}
			} // length-distance pair
		} // length-distance pair or end-of-block
	} // loop until we reach end of block
	return blockSize;
}

// compression method 8
// deflate: http://tools.ietf.org/html/rfc1951
function inflate(compressedData, numDecompressedBytes) {
	var buffer = new Buffer(numDecompressedBytes);
	var bstream = new BitStream(compressedData);
	var numBlocks = 0, blockSize = 0;
	// block format: http://tools.ietf.org/html/rfc1951#page-9
	do {
		var bFinal = bstream.readBits(1),
			bType = bstream.readBits(2);
		blockSize = 0;
		++numBlocks;
		// no compression
		if (bType == 0) {
			// skip remaining bits in this byte
			while (bstream.bitPtr != 0) bstream.readBits(1);
			var len = bstream.readBits(16),
				nlen = bstream.readBits(16);
			// TODO: check if nlen is the ones-complement of len?
			buffer.insertBytes(bstream.readBytes(len));
			blockSize = len;
		}
		// fixed Huffman codes
		else if(bType == 1) {
			blockSize = inflateBlockData(bstream, getFixedLiteralTable(), getFixedDistanceTable(), buffer);
		}
		// dynamic Huffman codes
		else if(bType == 2) {
			var numLiteralLengthCodes = bstream.readBits(5) + 257;
			var numDistanceCodes = bstream.readBits(5) + 1,
				numCodeLengthCodes = bstream.readBits(4) + 4;
				
			// populate the array of code length codes (first de-compaction)		
			var codeLengthsCodeLengths = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
			for (var i = 0; i < numCodeLengthCodes; ++i) {
				codeLengthsCodeLengths[ CodeLengthCodeOrder[i] ] = bstream.readBits(3);
			}
			
			// get the Huffman Codes for the code lengths
			var codeLengthsCodes = getHuffmanCodes(codeLengthsCodeLengths);
			
			// now follow this mapping 
			/*
               0 - 15: Represent code lengths of 0 - 15
                   16: Copy the previous code length 3 - 6 times.
                       The next 2 bits indicate repeat length
                             (0 = 3, ... , 3 = 6)
                          Example:  Codes 8, 16 (+2 bits 11),
                                    16 (+2 bits 10) will expand to
                                    12 code lengths of 8 (1 + 6 + 5)
                   17: Repeat a code length of 0 for 3 - 10 times.
                       (3 bits of length)
                   18: Repeat a code length of 0 for 11 - 138 times
                       (7 bits of length)
			*/
			// to generate the true code lengths of the Huffman Codes for the literal
			// and distance tables together
			var literalCodeLengths = [];
			var prevCodeLength = 0;
			while (literalCodeLengths.length < numLiteralLengthCodes + numDistanceCodes) {
				var symbol = decodeSymbol(bstream, codeLengthsCodes);
				if (symbol <= 15) {
					literalCodeLengths.push(symbol);
					prevCodeLength = symbol;
				}
				else if (symbol == 16) {
					var repeat = bstream.readBits(2) + 3;
					while (repeat--) {
						literalCodeLengths.push(prevCodeLength);
					}
				}
				else if (symbol == 17) {
					var repeat = bstream.readBits(3) + 3;
					while (repeat--) {
						literalCodeLengths.push(0);
					}
				}
				else if (symbol == 18) {
					var repeat = bstream.readBits(7) + 11;
					while (repeat--) {
						literalCodeLengths.push(0);
					}
				}
			}
			
			// now split the distance code lengths out of the literal code array
			var distanceCodeLengths = literalCodeLengths.splice(numLiteralLengthCodes, numDistanceCodes);
			
			// now generate the true Huffman Code tables using these code lengths
			var hcLiteralTable = getHuffmanCodes(literalCodeLengths),
				hcDistanceTable = getHuffmanCodes(distanceCodeLengths);
			blockSize = inflateBlockData(bstream, hcLiteralTable, hcDistanceTable, buffer);
		}
		// error
		else {
			throw "Error! Encountered deflate block of type 3";
			return null;
		}

		// update progress
		progress.currentFileBytesUnzipped += blockSize;
		progress.totalBytesUnzipped += blockSize;
		postMessage(progress);

	} while (bFinal != 1);
	// we are done reading blocks if the bFinal bit was set for this block
	
	// return the buffer data joined together as a binary string
	return buffer.data.join("");
}

// =======================
// NOTES on the RAR format
// http://kthoom.googlecode.com/hg/docs/unrar.html

// Volume Types
var MARK_HEAD			= 0x72,
	MAIN_HEAD			= 0x73,
	FILE_HEAD			= 0x74,
	COMM_HEAD			= 0x75,
	AV_HEAD				= 0x76,
	SUB_HEAD			= 0x77,
	PROTECT_HEAD		= 0x78,
	SIGN_HEAD			= 0x79,
	NEWSUB_HEAD			= 0x7a,
	ENDARC_HEAD			= 0x7b;

// bstream is a bit stream
function RarVolumeHeader(bstream, bDebug) {

	this.debug = bDebug;

	// byte 1,2
	this.crc = bstream.readBits(16);
	if (bDebug)
		postMessage("  crc=" + this.crc);

	// byte 3
	this.headType = bstream.readBits(8);
	if (bDebug)
		postMessage("  headType=" + this.headType);

	// Get flags
	// bytes 4,5
	this.flags = {};
	this.flags.value = bstream.peekBits(16);
	if (bDebug)
		postMessage("  flags=" + twoByteValueToHexString(this.flags.value));
	switch (this.headType) {
	case MAIN_HEAD:
		this.flags.MHD_VOLUME = !!bstream.readBits(1);
		this.flags.MHD_COMMENT = !!bstream.readBits(1);
		this.flags.MHD_LOCK = !!bstream.readBits(1);
		this.flags.MHD_SOLID = !!bstream.readBits(1);
		this.flags.MHD_PACK_COMMENT = !!bstream.readBits(1);
		this.flags.MHD_NEWNUMBERING = this.flags.MHD_PACK_COMMENT;
		this.flags.MHD_AV = !!bstream.readBits(1);
		this.flags.MHD_PROTECT = !!bstream.readBits(1);
		this.flags.MHD_PASSWORD = !!bstream.readBits(1);
		this.flags.MHD_FIRSTVOLUME = !!bstream.readBits(1);
		this.flags.MHD_ENCRYPTVER = !!bstream.readBits(1);
		bstream.readBits(6); // unused
		break;
	case FILE_HEAD:
		this.flags.LHD_SPLIT_BEFORE = !!bstream.readBits(1); // 0x0001
		this.flags.LHD_SPLIT_AFTER = !!bstream.readBits(1); // 0x0002
		this.flags.LHD_PASSWORD = !!bstream.readBits(1); // 0x0004
		this.flags.LHD_COMMENT = !!bstream.readBits(1); // 0x0008
		this.flags.LHD_SOLID = !!bstream.readBits(1); // 0x0010
		bstream.readBits(3); // unused
		this.flags.LHD_LARGE = !!bstream.readBits(1); // 0x0100
		this.flags.LHD_UNICODE = !!bstream.readBits(1); // 0x0200
		this.flags.LHD_SALT = !!bstream.readBits(1); // 0x0400
		this.flags.LHD_VERSION = !!bstream.readBits(1); // 0x0800
		this.flags.LHD_EXTTIME = !!bstream.readBits(1); // 0x1000
		this.flags.LHD_EXTFLAGS = !!bstream.readBits(1); // 0x2000
		bstream.readBits(2); // unused
		if (bDebug)
			postMessage("  LHD_SPLIT_BEFORE = " + this.flags.LHD_SPLIT_BEFORE);
		break;
	default:
		bstream.readBits(16);
	}
	
	// byte 6,7
	this.headSize = bstream.readBits(16);
	if (bDebug)
		postMessage("  headSize=" + this.headSize);
	
	switch (this.headType) {
	case MAIN_HEAD:
		this.highPosAv = bstream.readBits(16);
		this.posAv = bstream.readBits(32);
		if (this.flags.MHD_ENCRYPTVER)
			this.encryptVer = bstream.readBits(8);
		if (this.debug)
			postMessage("Found MAIN_HEAD with highPosAv=" + this.highPosAv + ", posAv=" + this.posAv);
		break;
	case FILE_HEAD:
		this.packSize = bstream.readBits(32);
		this.unpackedSize = bstream.readBits(32);
		this.hostOS = bstream.readBits(8);
		this.fileCRC = bstream.readBits(32);
		this.fileTime = bstream.readBits(32);
		this.unpVer = bstream.readBits(8);
		this.method = bstream.readBits(8);
		this.nameSize = bstream.readBits(16);
		this.fileAttr = bstream.readBits(32);

		if (this.flags.LHD_LARGE) {
			postMessage("Warning: Reading in LHD_LARGE 64-bit size values");
			this.HighPackSize = bstream.readBits(32);
			this.HighUnpSize = bstream.readBits(32);
		}
		
		// read in filename
		this.filename = bstream.readBytes(this.nameSize);
		
		if (this.flags.LHD_SALT) {
			postMessage("Warning: Reading in 64-bit salt value");
			this.salt = bstream.readBits(64); // 8 bytes
		}
		
		if (this.flags.LHD_EXTTIME) {
			// 16-bit flags
			var extTimeFlags = bstream.readBits(16);
			
			// this is adapted straight out of arcread.cpp, Archive::ReadHeader()
			for (var I = 0; I < 4; ++I) {
            	var rmode = extTimeFlags >> ((3-I)*4);
            	if ((rmode & 8)==0)
            		continue;
            	if (I!=0)
            		bstream.readBits(16);
            	var count = (rmode&3);
            	for (var J = 0; J < count; ++J) 
            		bstream.readBits(8);
            }
		}
		
		if (this.flags.LHD_COMMENT) {
			postMessage("Found a LHD_COMMENT");
		}
		
//		if (bDebug)
//			postMessage("BytePtr = " + bstream.bytePtr);
		
		if (this.debug)
			postMessage("Found FILE_HEAD with packSize=" + this.packSize + ", unpackedSize= " + this.unpackedSize + ", hostOS=" + this.hostOS + ", unpVer=" + this.unpVer + ", method=" + this.method + ", filename=" + this.filename);
	
		break;
	default:
		if (this.debug)
			postMessage("Found a header of type 0x" + byteValueToHexString(this.headType));
		// skip the rest of the header bytes (for now)
		bstream.readBytes( this.headSize - 7 );
		break;
	}

}

var BLOCK_LZ = 0,
	BLOCK_PPM = 1;

var rLDecode = [0,1,2,3,4,5,6,7,8,10,12,14,16,20,24,28,32,40,48,56,64,80,96,112,128,160,192,224],
	rLBits = [0,0,0,0,0,0,0,0,1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4,  4,  5,  5,  5,  5],
	rDBitLengthCounts = [4,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,14,0,12],
	rSDDecode = [0,4,8,16,32,64,128,192],
	rSDBits = [2,2,3, 4, 5, 6,  6,  6],
	rDDecode = null,
	rDBits = null;

var rNC = 299,
	rDC = 60,
	rLDC = 17,
	rRC = 28,
	rBC = 20,
	rHUFF_TABLE_SIZE = (rNC+rDC+rRC+rLDC);

var UnpBlockType = BLOCK_LZ;

// read in Huffman tables for RAR
function RarReadTables(bstream) {
	var BitLength = new Array(rBC),
		Table = new Array(rHUFF_TABLE_SIZE);

	// before we start anything we need to get byte-aligned
	bstream.readBits( (8 - bstream.BitPtr) & 0x7 );
	
	var isPPM = bstream.peekBits(1);
	if (isPPM) {
		UnpBlockType = BLOCK_PPM;
		// TODO: implement PPM stuff
		postMessage("Error!  PPM not implemented yet");
		return;
	}
	else {
		bstream.readBits(1);
		
		var keepOldTable = bstream.readBits(1);
		if (!keepOldTable) {
			// TODO: clear old table if !keepOldTable
		}
		
		// read in bit lengths
		for (var I = 0; I < rBC; ++I) {
			var Length = bstream.readBits(4);
			if (Length == 15) {
				var ZeroCount = bstream.readBits(4);
				if (ZeroCount == 0) {
					BitLength[I] = 15;
				}
				else {
					ZeroCount += 2;
					while (ZeroCount-- > 0 && I < rBC)
						BitLength[I++] = 0;
					--I;
				}
			}
			else {
				BitLength[I] = Length;
			}
		}
		
		// now all 20 bit lengths are obtained, we construct the Huffman Table:
		var LenCount = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
			TmpPos = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
			DecodeLen = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
			DecodePos = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
			DecodeNum = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
			N = 0,
			M = 0;
			
		for (var i = 0; i < rBC; ++i) { postMessage("BitLength[" + i + "] is " + BitLength[i]); }
		
		// count number of codes for each length
		for (I = 0; I < rBC; ++I)
			LenCount[BitLength[I] & 0xF]++;
		LenCount[0] = 0;
		
		for (var i = 0; i < 16; ++i) { postMessage("Count of length " + i + " is " + LenCount[i]); }
		
		for (I = 1; I < 16; ++I) {
			N = 2 * (N+LenCount[I]);
			M = (N << (15-I));
			if (M > 0xFFFF)
				M = 0xFFFF;
			DecodeLen[I] = M;
			DecodePos[I] = DecodePos[I-1] + LenCount[I-1];
			TmpPos[I] = DecodePos[I];
			postMessage(" I=" + I + ", LenCount[I]=" + LenCount[I] + ", N=" + N + ", M=" + M);
		}
		
		for (I = 0; I < rBC; ++I)
			if (BitLength[I] != 0)
				DecodeNum[ TmpPos[ BitLength[I] & 0xF ]++] = I;

		for (I = 0; I < rBC; ++I) {
			postMessage("Code[" + I + "] has Len=" + DecodeLen[I] + ", Pos=" + DecodePos[I] + ", Num=" + DecodeNum[I]);
		}
	}
}

// TODO: implement
function Unpack15(bstream, Solid) {
	postMessage("ERROR!  RAR 1.5 compression not supported");
}

function Unpack20(bstream, Solid) {
	postMessage("ERROR!  RAR 2.0 compression not supported");
}

function Unpack29(bstream, Solid) {
	// lazy initialize rDDecode and rDBits
	if (rDDecode == null) {
		rDDecode = new Array(rDC);
		rDBits = new Array(rDC);
		var Dist=0,BitLength=0,Slot=0;
		for (var I = 0; I < rDBitLengthCounts.length / 4; I++,BitLength++) {
			for (var J = 0; J < rDBitLengthCounts[I]; J++,Slot++,Dist+=(1<<BitLength)) {
				rDDecode[Slot]=Dist;
				rDBits[Slot]=BitLength;
			}
		}
	}
	
	// initialize data

	// read in Huffman tables
	RarReadTables(bstream);

	postMessage("ERROR!  RAR 2.9 compression not yet supported");
}

/** Adapt this:

void Unpack::Unpack29(bool Solid)
{
  static unsigned char LDecode[]={0,1,2,3,4,5,6,7,8,10,12,14,16,20,24,28,32,40,48,56,64,80,96,112,128,160,192,224};
  static unsigned char LBits[]=  {0,0,0,0,0,0,0,0,1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4,  4,  5,  5,  5,  5};
  static int DDecode[DC];
  static byte DBits[DC];
  static int DBitLengthCounts[]= {4,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,14,0,12};
  static unsigned char SDDecode[]={0,4,8,16,32,64,128,192};
  static unsigned char SDBits[]=  {2,2,3, 4, 5, 6,  6,  6};
  unsigned int Bits;

  if (DDecode[1]==0)
  {
    int Dist=0,BitLength=0,Slot=0;
    for (int I=0;I<sizeof(DBitLengthCounts)/sizeof(DBitLengthCounts[0]);I++,BitLength++)
      for (int J=0;J<DBitLengthCounts[I];J++,Slot++,Dist+=(1<<BitLength))
      {
        DDecode[Slot]=Dist;
        DBits[Slot]=BitLength;
      }
  }

  FileExtracted=true;

  if (!Suspended)
  {
    UnpInitData(Solid);
    if (!UnpReadBuf())
      return;
    if ((!Solid || !TablesRead) && !ReadTables())
      return;
  }

  while (true)
  {
    UnpPtr&=MAXWINMASK;

    if (InAddr>ReadBorder)
    {
      if (!UnpReadBuf())
        break;
    }
    if (((WrPtr-UnpPtr) & MAXWINMASK)<260 && WrPtr!=UnpPtr)
    {
      UnpWriteBuf();
      if (WrittenFileSize>DestUnpSize)
        return;
      if (Suspended)
      {
        FileExtracted=false;
        return;
      }
    }
    if (UnpBlockType==BLOCK_PPM)
    {
      // Here speed is critical, so we do not use SafePPMDecodeChar,
      // because sometimes even the inline function can introduce
      // some additional penalty.
      int Ch=PPM.DecodeChar();
      if (Ch==-1)              // Corrupt PPM data found.
      {
        PPM.CleanUp();         // Reset possibly corrupt PPM data structures.
        UnpBlockType=BLOCK_LZ; // Set faster and more fail proof LZ mode.
        break;
      }
      if (Ch==PPMEscChar)
      {
        int NextCh=SafePPMDecodeChar();
        if (NextCh==0)  // End of PPM encoding.
        {
          if (!ReadTables())
            break;
          continue;
        }
        if (NextCh==-1) // Corrupt PPM data found.
          break;
        if (NextCh==2)  // End of file in PPM mode..
          break;
        if (NextCh==3)  // Read VM code.
        {
          if (!ReadVMCodePPM())
            break;
          continue;
        }
        if (NextCh==4) // LZ inside of PPM.
        {
          unsigned int Distance=0,Length;
          bool Failed=false;
          for (int I=0;I<4 && !Failed;I++)
          {
            int Ch=SafePPMDecodeChar();
            if (Ch==-1)
              Failed=true;
            else
              if (I==3)
                Length=(byte)Ch;
              else
                Distance=(Distance<<8)+(byte)Ch;
          }
          if (Failed)
            break;

          CopyString(Length+32,Distance+2);
          continue;
        }
        if (NextCh==5) // One byte distance match (RLE) inside of PPM.
        {
          int Length=SafePPMDecodeChar();
          if (Length==-1)
            break;
          CopyString(Length+4,1);
          continue;
        }
        // If we are here, NextCh must be 1, what means that current byte
        // is equal to our 'escape' byte, so we just store it to Window.
      }
      Window[UnpPtr++]=Ch;
      continue;
    }

    int Number=DecodeNumber((struct Decode *)&LD);
    if (Number<256)
    {
      Window[UnpPtr++]=(byte)Number;
      continue;
    }
    if (Number>=271)
    {
      int Length=LDecode[Number-=271]+3;
      if ((Bits=LBits[Number])>0)
      {
        Length+=getbits()>>(16-Bits);
        addbits(Bits);
      }

      int DistNumber=DecodeNumber((struct Decode *)&DD);
      unsigned int Distance=DDecode[DistNumber]+1;
      if ((Bits=DBits[DistNumber])>0)
      {
        if (DistNumber>9)
        {
          if (Bits>4)
          {
            Distance+=((getbits()>>(20-Bits))<<4);
            addbits(Bits-4);
          }
          if (LowDistRepCount>0)
          {
            LowDistRepCount--;
            Distance+=PrevLowDist;
          }
          else
          {
            int LowDist=DecodeNumber((struct Decode *)&LDD);
            if (LowDist==16)
            {
              LowDistRepCount=LOW_DIST_REP_COUNT-1;
              Distance+=PrevLowDist;
            }
            else
            {
              Distance+=LowDist;
              PrevLowDist=LowDist;
            }
          }
        }
        else
        {
          Distance+=getbits()>>(16-Bits);
          addbits(Bits);
        }
      }

      if (Distance>=0x2000)
      {
        Length++;
        if (Distance>=0x40000L)
          Length++;
      }

      InsertOldDist(Distance);
      InsertLastMatch(Length,Distance);
      CopyString(Length,Distance);
      continue;
    }
    if (Number==256)
    {
      if (!ReadEndOfBlock())
        break;
      continue;
    }
    if (Number==257)
    {
      if (!ReadVMCode())
        break;
      continue;
    }
    if (Number==258)
    {
      if (LastLength!=0)
        CopyString(LastLength,LastDist);
      continue;
    }
    if (Number<263)
    {
      int DistNum=Number-259;
      unsigned int Distance=OldDist[DistNum];
      for (int I=DistNum;I>0;I--)
        OldDist[I]=OldDist[I-1];
      OldDist[0]=Distance;

      int LengthNumber=DecodeNumber((struct Decode *)&RD);
      int Length=LDecode[LengthNumber]+2;
      if ((Bits=LBits[LengthNumber])>0)
      {
        Length+=getbits()>>(16-Bits);
        addbits(Bits);
      }
      InsertLastMatch(Length,Distance);
      CopyString(Length,Distance);
      continue;
    }
    if (Number<272)
    {
      unsigned int Distance=SDDecode[Number-=263]+1;
      if ((Bits=SDBits[Number])>0)
      {
        Distance+=getbits()>>(16-Bits);
        addbits(Bits);
      }
      InsertOldDist(Distance);
      InsertLastMatch(2,Distance);
      CopyString(2,Distance);
      continue;
    }
  }
  UnpWriteBuf();
}

*/

// v must be a valid RarVolume
function unpack(v) {
	// TODO: implement what happens when unpVer is < 15
	var Ver = v.header.unpVer <= 15 ? 15 : v.header.unpVer,
		Solid = v.header.LHD_SOLID,
		bstream = new BitStream(v.fileData);
	
	switch(Ver) {
    case 15: // rar 1.5 compression
      Unpack15(bstream, Solid);
      break;
    case 20: // rar 2.x compression
    case 26: // files larger than 2GB
      Unpack20(bstream, Solid);
      break;
    case 29: // rar 3.x compression
    case 36: // alternative hash
      Unpack29(bstream, Solid);
      break;
	} // switch(method)
}

// bstream is a bit stream
function RarLocalFile(bstream, bDebug) {
	
	this.header = new RarVolumeHeader(bstream, bDebug);
	this.filename = this.header.filename;
	
	if (this.header.headType != FILE_HEAD) {
		this.isValid = false;
		progress.isValid = false;
		postMessage("Error! RAR Volume did not include a FILE_HEAD header");
	}
	else {
		// read in the compressed data
		this.fileData = null;
		if (this.header.packSize > 0) {
			this.fileData = bstream.readBytes(this.header.packSize);
			this.isValid = true;
		}
	}
}

RarLocalFile.prototype.unrar = function() {
	if (!this.header.flags.LHD_SPLIT_BEFORE) {
		// unstore file
		if (this.header.method == 0x30) {
			this.isValid = true;
			progress.currentFileBytesUnzipped += this.fileData.length;
			progress.totalBytesUnzipped += this.fileData.length;
		}
		else {
			unpack(this);
		}
	}
}

function unrar(bstr, bDebug) {
	var bstream = new BitStream(bstr);

	var header = new RarVolumeHeader(bstream, bDebug);
	if (header.crc == 0x6152 && 
		header.headType == 0x72 && 
		header.flags.value == 0x1A21 &&
		header.headSize == 7) 
	{
		if (bDebug)	
			postMessage("Found RAR signature");

		var mhead = new RarVolumeHeader(bstream, bDebug);
		if (mhead.headType != MAIN_HEAD) {
			progress.isValid = false;
			postMessage("Error! RAR did not include a MAIN_HEAD header");
		}
		else {
			var localFiles = [],
				localFile = null;
			do {
				localFile = new RarLocalFile(bstream, bDebug);
				if (bDebug)
					postMessage("RAR localFile isValid=" + localFile.isValid + ", volume packSize=" + localFile.header.packSize);
				if (localFile && localFile.isValid && localFile.header.packSize > 0) {
					progress.totalSizeInBytes += localFile.header.unpackedSize;
					progress.total
					progress.isValid = true;
					localFiles.push(localFile);
				}
			} while( localFile.isValid );

			progress.totalNumFilesInZip = localFiles.length;
			
			// now we have all information but things are unpacked
			// TODO: unpack
			for (var i = 0; i < localFiles.length; ++i) {
				var localfile = localFiles[i];
				
				// update progress 
				progress.currentFilename = localfile.header.filename;
				progress.currentFileBytesUnzipped = 0;
				
				// actually do the unzipping
				localfile.unrar();
				
				if (localfile.isValid) {
					progress.localFiles.push(localfile);
					postMessage(progress);
				}
			}
			
			progress.isDone = true;
			postMessage(progress);
		}
	}
	else {
		postMessage("Unknown file!");
	}
}

onmessage = function(event) {
	postMessage( unzip(event.data, false) );
};

