import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});
await mkdir('dist',{recursive:true});
for (const entry of ['index.html','src','assets']) await cp(entry,`dist/${entry}`,{recursive:true});
await writeFile('dist/.nojekyll','');
console.log('Ready: dist/ — deploy to GitHub Pages or any static HTTPS host.');
