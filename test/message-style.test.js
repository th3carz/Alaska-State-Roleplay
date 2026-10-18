import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection, MessageFlags } from 'discord.js';
import { plainMessageEdit, migrateMessageStyles } from '../src/message-style.js';
import { APPLICATION_ID, GUILD_ID, Store } from '../src/store.js';

test('existing V2 cards lose custom emoji icons and accents while controls and attachments stay intact', () => {
  const control={type:2,custom_id:'ticket:unclaim:1',style:2,label:'Unclaim',disabled:false,emoji:{id:'123',name:'custom'}};
  const original={author:{id:APPLICATION_ID},flags:MessageFlags.IsComponentsV2,attachments:new Collection([['image',{id:'image'}]]),
    components:[{type:17,accent_color:123,components:[{type:10,content:'<:logo:123> Support <a:loading:456>'},
      {type:12,items:[{media:{url:'attachment://support.png'}}]},
      {type:1,components:[control,{type:2,style:5,label:'Join',url:'https://erlc.gg/join/Alaska'}]}]}]};
  const edit=plainMessageEdit(original);
  assert.equal(edit.flags,MessageFlags.IsComponentsV2);
  assert.equal(edit.components[0].accent_color,null);
  assert.equal(edit.components[0].components[0].content,' Support ');
  assert.deepEqual(edit.components[0].components[2].components[0],{type:2,custom_id:'ticket:unclaim:1',style:2,label:'Unclaim',disabled:false});
  assert.equal(edit.components[0].components[1].items[0].media.url,'attachment://support.png');
  assert.equal(edit.components[0].components[2].components[1].url,'https://erlc.gg/join/Alaska');
  assert.equal(edit.attachments,undefined);
  assert.equal(edit.files,undefined);
  assert.deepEqual(edit.allowedMentions,{parse:[]});
  assert.equal(original.components[0].accent_color,123);
});

test('legacy archives become V2 with visible downloadable file components', () => {
  const message={author:{id:APPLICATION_ID},content:'',embeds:[{title:'Ticket Closed',description:'Resolved',color:123}],
    attachments:new Collection([['html',{id:'html',name:'Ticket-1.html'}]]),components:[]};
  const edit=plainMessageEdit(message);
  assert.equal(edit.flags,MessageFlags.IsComponentsV2);
  assert.deepEqual(edit.embeds,[]);
  assert.equal(edit.content,null);
  assert.equal(edit.attachments,undefined);
  assert.equal(edit.components[0].accent_color,null);
  assert.ok(edit.components[0].components.some(c=>c.type===13&&c.file.url==='attachment://Ticket-1.html'));
});

test('foreign messages, plain text, and already clean cards are never rewritten', () => {
  assert.equal(plainMessageEdit({author:{id:'foreign'},embeds:[{title:'Support'}]}),null);
  assert.equal(plainMessageEdit({author:{id:APPLICATION_ID},content:'plain'}),null);
  assert.equal(plainMessageEdit({author:{id:APPLICATION_ID},flags:32768,components:[{type:17,accent_color:null,components:[{type:10,content:'Clean'}]}]}),null);
});

test('style migration preserves history pagination and runs only once after completing', async t => {
  const store=new Store(':memory:'); t.after(()=>store.close());
  let fetches=0,edits=0;
  const channel={messages:{fetch:async options=>{
    fetches++;
    if(options.before)return new Collection([['1',{id:'1',author:{id:APPLICATION_ID},embeds:[{title:'Older'}],edit:async()=>{edits++;}}]]);
    return new Collection(Array.from({length:100},(_,n)=>[String(200-n),{id:String(200-n),author:{id:'foreign'}}]));
  }}};
  const bot={store,channel:async()=>channel};
  await migrateMessageStyles(bot,{id:GUILD_ID});
  assert.equal(fetches,2);assert.equal(edits,1);
  await migrateMessageStyles(bot,{id:GUILD_ID});
  assert.equal(fetches,2);assert.equal(edits,1);
});
