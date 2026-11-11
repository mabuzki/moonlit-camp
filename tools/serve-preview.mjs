import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const entry='/assets/export/moonlit-camp-v1/preview.html';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.gif':'image/gif','.css':'text/css; charset=utf-8','.csv':'text/csv; charset=utf-8','.txt':'text/plain; charset=utf-8','.zip':'application/zip'};
const server=http.createServer((request,response)=>{
  if(request.method!=='GET'&&request.method!=='HEAD'){response.writeHead(405);response.end();return;}
  let pathname;
  try{pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);}catch{response.writeHead(400);response.end();return;}
  if(pathname==='/'){response.writeHead(302,{Location:entry});response.end();return;}
  const target=path.resolve(root,'.'+pathname);
  if(!target.startsWith(root)||pathname.includes('\0')){response.writeHead(403);response.end();return;}
  fs.stat(target,(error,stat)=>{
    if(error||!stat.isFile()){response.writeHead(404);response.end('Not found');return;}
    response.writeHead(200,{'Content-Type':types[path.extname(target).toLowerCase()]??'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    if(request.method==='HEAD'){response.end();return;}
    fs.createReadStream(target).on('error',()=>response.destroy()).pipe(response);
  });
});
server.listen(0,'127.0.0.1',()=>{
  const port=server.address().port;
  const state={pid:process.pid,port,url:`http://127.0.0.1:${port}${entry}`,root};
  fs.mkdirSync(path.join(root,'output/runtime'),{recursive:true});
  fs.writeFileSync(path.join(root,'output/runtime/preview-server.json'),JSON.stringify(state,null,2)+'\n');
  console.log(state.url);
});
