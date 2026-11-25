import {decodeImage} from './decoder.js';
// Native detector is optional; it never replaces the checksum / two-frame gate.
let native = null;
const init=(async()=>{try{if(typeof BarcodeDetector!=='undefined'&&(await BarcodeDetector.getSupportedFormats()).includes('code_39'))native=new BarcodeDetector({formats:['code_39']});}catch{}})();
self.onmessage=async({data})=>{try{await init;let codes=[];if(native){try{codes=(await native.detect(data.image)).map(r=>r.rawValue);}catch{native=null;}}if(!codes.length)codes=decodeImage(data.image,!!data.exhaustive);else if(data.exhaustive){for(const c of decodeImage(data.image,true))if(!codes.includes(c))codes.push(c);}self.postMessage({id:data.id,codes});}catch{self.postMessage({id:data.id,error:true});}};
