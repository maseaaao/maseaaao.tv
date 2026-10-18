import {spawn} from 'node:child_process';
import readline from 'node:readline';

// Owns only its own child. A failed or timed-out command is never replayed.
export class HelperProcess {
  constructor({file,args=[],timeout=12000,retry=3000,onLine,onOffline,spawnProcess=spawn}) {
    Object.assign(this,{file,args,timeout,retry,onLine,onOffline,spawnProcess});
    this.stopped=true;this.failures=0;
  }
  start() {this.stop();this.stopped=false;this.open();}
  open() {
    if(this.stopped)return;
    let child;
    try {child=this.spawnProcess(this.file,this.args,{windowsHide:true,stdio:['pipe','pipe','pipe']});}
    catch {this.onOffline('Audio helper could not start');this.schedule();return;}
    this.child=child;this.lastSeen=Date.now();let done=false;
    const lines=readline.createInterface({input:child.stdout});
    const finish=message=>{
      if(done)return;done=true;lines.close();clearInterval(watchdog);
      if(this.child!==child)return;
      this.child=null;this.finish=null;
      try {child.stdin.end();child.kill();}catch{}
      this.onOffline(message);
      if(!this.stopped)this.schedule();
    };
    this.finish=finish;
    const watchdog=setInterval(()=>{if(Date.now()-this.lastSeen>=this.timeout)finish('Audio helper is not responding');},Math.min(1000,this.timeout));
    child.stdin.on('error',()=>finish('Audio helper input failed'));
    child.stderr.on('data',()=>{});
    let partialBytes=0;
    child.stdout.on('data',data=>{
      if(done)return;
      const bytes=Buffer.from(data);const newline=bytes.lastIndexOf(10);
      partialBytes=newline<0?partialBytes+bytes.length:bytes.length-newline-1;
      if(partialBytes>65536)finish('Audio helper output limit');
    });
    lines.on('line',line=>{
      if(done||this.child!==child)return;
      try {
        if(line.length>65536)throw new Error('status size');
        this.onLine(line);this.lastSeen=Date.now();this.failures=0;
      }catch {finish('Invalid audio helper status');}
    });
    child.once('error',()=>finish('Audio helper could not start'));
    child.once('close',()=>finish('Audio helper stopped'));
  }
  schedule() {
    if(this.stopped||this.retryTimer)return;
    const delay=Math.min(30000,this.retry*2**Math.min(this.failures++,4));
    this.retryTimer=setTimeout(()=>{this.retryTimer=null;this.open();},delay);
  }
  send(line) {
    if(this.stopped||!this.child||Date.now()-this.lastSeen>=this.timeout)return false;
    try {this.child.stdin.write(line+'\n');return true;}
    catch {this.finish?.('Audio helper input failed');return false;}
  }
  stop() {
    this.stopped=true;clearTimeout(this.retryTimer);this.retryTimer=null;
    this.finish?.('Audio helper stopped');this.finish=null;
  }
}
