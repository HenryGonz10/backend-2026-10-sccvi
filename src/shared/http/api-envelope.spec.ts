import { failure,isApiEnvelope,success } from './api-envelope';
describe('SCCVI API envelope',()=>{it('always requires valid, data and msg',()=>{expect(success({id:'1'})).toEqual({valid:true,data:{id:'1'},msg:'Operación completada.'});expect(failure('No autorizado.')).toEqual({valid:false,data:null,msg:'No autorizado.'});expect(isApiEnvelope({data:'ok'})).toBe(false);});});
