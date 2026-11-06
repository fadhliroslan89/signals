#!/usr/bin/env bash
# MacBook: bash scripts_chat_id.sh. Token is requested interactively (not stored in shell history).
set -eu
printf 'Buka Telegram, hantar /start dan apa-apa mesej kepada bot sendiri dahulu.\n'
printf 'Masukkan token BotFather (tidak akan dipaparkan): '
trap 'stty echo 2>/dev/null || true' EXIT
stty -echo
IFS= read -r token
stty echo
printf '\n'
if [[ -z "$token" ]]; then echo 'Token kosong'; exit 1; fi
export TELEGRAM_TMP_TOKEN="$token"
node - <<'NODE'
const https=require('https');
const token=process.env.TELEGRAM_TMP_TOKEN;
const req=https.get(`https://api.telegram.org/bot${token}/getUpdates`,res=>{
 let data='';res.on('data',b=>data+=b);res.on('end',()=>{
   try{
     const json=JSON.parse(data);
     if(!json.ok){console.error('Telegram API gagal:',json.description||'unknown');process.exitCode=1;return;}
     const chats=new Map();for(const item of (json.result||[])){
       const chat=item.message?.chat||item.edited_message?.chat||item.channel_post?.chat;
       if(chat)chats.set(String(chat.id), `${chat.type}: ${chat.title||chat.first_name||''}`);
     }
     if(!chats.size)console.log('Tiada mesej lagi. Hantar /start serta mesej kepada bot, kemudian ulang arahan ini.');
     else for(const [id,label] of chats)console.log('CHAT ID:',id,'—',label);
   }catch(err){console.error('Respons tidak boleh dibaca:',err.message);process.exitCode=1;}
 });
});req.on('error',e=>{console.error(e.message);process.exitCode=1;});
NODE
unset TELEGRAM_TMP_TOKEN
