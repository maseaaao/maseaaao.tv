import { InstanceBase, InstanceStatus } from '@companion-module/base'
import { HelperProcess } from '../shared/helper-process.mjs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export default class SystemMicrophone extends InstanceBase {
  async init(config) {
    this.setVariableDefinitions({state:{name:'Microphone mute state'},volume:{name:'Windows input volume (%)'},device:{name:'Microphone device'},available:{name:'Microphone available'}})
    this.setActionDefinitions({toggle:{name:'Toggle system microphone mute',options:[],callback:()=>this.send('toggle')},mute:{name:'Mute system microphone',options:[],callback:()=>this.send('mute')},unmute:{name:'Unmute system microphone',options:[],callback:()=>this.send('unmute')}})
    this.setFeedbackDefinitions({muted:{type:'boolean',name:'Microphone is muted',options:[],defaultStyle:{bgcolor:11739175,color:16777215},callback:()=>this.available && this.muted},unavailable:{type:'boolean',name:'Microphone unavailable',options:[],defaultStyle:{bgcolor:6513507,color:16777215},callback:()=>!this.available}})
    this.setPresetDefinitions([{id:'mic',name:'System microphone',definitions:['mic']},{id:'speaker',name:'System speakers',definitions:['speaker']}],{mic:{type:'simple',name:'System microphone mute and volume',style:{text:'🎤 $(local-system-microphone:state)\n$(local-system-microphone:volume)%',size:'auto',color:16777215,bgcolor:1793104},steps:[{down:[{actionId:'toggle',options:{}}],up:[]}],feedbacks:[{feedbackId:'muted',options:{},style:{bgcolor:11739175,color:16777215}},{feedbackId:'unavailable',options:{},style:{bgcolor:6513507,color:16777215}}]},speaker:{type:'simple',name:'System speakers mute and volume',style:{text:'🔊 $(local-system-microphone:state)\n$(local-system-microphone:volume)%',size:'auto',color:16777215,bgcolor:1793104},steps:[{down:[{actionId:'toggle',options:{}}],up:[]}],feedbacks:[{feedbackId:'muted',options:{},style:{bgcolor:11739175,color:16777215}},{feedbackId:'unavailable',options:{},style:{bgcolor:6513507,color:16777215}}]}})
    await this.configUpdated(config)
  }
  getConfigFields() {
    return [{type:'dropdown',id:'dataFlow',label:'Device type',width:12,default:'capture',choices:[{id:'capture',label:'Microphone (input)'},{id:'render',label:'Speakers / headphones (output)'}]},{type:'textinput',id:'libraryDirectory',label:'Streamer.bot folder (NAudio libraries)',width:12,default:''},{type:'textinput',id:'deviceId',label:'Windows endpoint ID (empty = current default device)',width:12,default:''}]
  }
  async configUpdated(config) {
    this.stop()
    this.config={...config,dataFlow:config.dataFlow || 'capture'}
    this.start()
  }
  offline(message) {
    this.lastPublished=null
    this.available=false
    this.setVariableValues({state:'НЕТ СВЯЗИ',volume:'—',device:'',available:false})
    this.updateStatus(InstanceStatus.ConnectionFailure,message)
    this.checkFeedbacks('muted','unavailable')
  }
  start() {
    this.offline('Connecting to Windows audio')
    this.helper=new HelperProcess({
      file:path.join(path.dirname(fileURLToPath(import.meta.url)),'SystemAudioHelper.exe'),
      args:[this.config.deviceId||'',this.config.dataFlow||'capture'],timeout:6000,
      onLine:line=>{
        const value=JSON.parse(line)
        if(!value.available){this.offline(value.error||'Audio device unavailable');return}
        const signature=JSON.stringify(value)
        this.available=true;this.muted=value.muted
        if(signature!==this.lastPublished){
          this.lastPublished=signature
          this.setVariableValues({state:value.muted?'ВЫКЛ':'ВКЛ',volume:value.volume,device:value.name,available:true})
          this.updateStatus(InstanceStatus.Ok);this.checkFeedbacks('muted','unavailable')
        }
      },onOffline:message=>this.offline(message)
    })
    this.helper.start()
  }
  send(command) {
    if(!this.available||!this.helper?.send(JSON.stringify({command})))this.offline('Audio device unavailable')
  }
  stop() {this.helper?.stop();this.helper=null;this.lastPublished=null}
  async destroy(){this.stop()}
}
// Preserve pinned endpoint IDs and explicitly selected output devices.
export const UpgradeScripts=[(_context,props)=>({
  updatedConfig:props.config && !props.config.dataFlow ? {...props.config,dataFlow:'capture'} : null,
  updatedActions:[],updatedFeedbacks:[]
})]
