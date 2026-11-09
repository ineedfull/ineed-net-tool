import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root=fileURLToPath(new URL('../..',import.meta.url));
const require=createRequire(import.meta.url);
const executablePath=process.env.ELECTRON_BINARY||require('electron');
test('Ping target info loads independently, exports and survives restart without inventing old history fields',async({},info)=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'nettool-target-info-'));let app;
  const launch=()=>electron.launch({executablePath,args:[root],env:{...process.env,NET_TOOL_TEST_DATA:folder}});
  await fs.writeFile(path.join(folder,'workspace.json'),JSON.stringify({version:1,networks:[],settings:{theme:'light',largeFont:false},history:[{id:'old',kind:'ping',target:'legacy.example',startedAt:'2026-01-01T00:00:00Z',status:'completed',rows:[],completed:0}]}));
  try {
    app=await launch();let page=await app.firstWindow();const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.getByRole('button',{name:'Ping 工具',exact:true}).click();
    await page.getByLabel('ping目标').fill('127.0.0.1');
    await page.getByLabel('Ping 次数').fill('1');
    await page.getByRole('button',{name:'开始探测',exact:true}).click();
    await expect(page.locator('.section-heading .badge').first()).toHaveText('已完成');
    await expect(page.getByLabel('主机名',{exact:true})).toContainText(os.hostname());
    await expect(page.getByLabel('MAC 地址',{exact:true})).toContainText('回环');
    expect((await page.evaluate(()=>window.netTool.load())).history[0].targetInfo.hostname.value).toBe(os.hostname());
    // Use simulated identity only for deterministic vendor/layout assertions; Ping remains real loopback.
    await app.evaluate(({app,dialog},folder)=>{
      const require=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json');
      const {NetworkTasks}=require('./electron/network.cjs');const execute=NetworkTasks.prototype.execute;
      const {vendorForMac}=require('./electron/target-info.cjs');
      NetworkTasks.prototype.execute=function(task,addresses){
        this.identifyTarget=async(ip,signal)=>{
          await new Promise(resolve=>setTimeout(resolve,400));
          return {ip,status:'complete',hostname:{value:'fixture-host.example.test',source:'测试 PTR'},mac:{value:'00:0C:29:01:02:03',source:'测试邻居记录'},vendor:vendorForMac('00:0C:29:01:02:03'),checkedAt:new Date().toISOString()};
        };
        return execute.call(this,task,addresses);
      };
      dialog.showSaveDialog=async()=>({canceled:false,filePath:folder+'/export.json'});
    },folder);
    await page.getByRole('button',{name:'重新探测',exact:true}).click();
    await expect(page.locator('.result-panel tbody tr')).toHaveCount(1);
    await expect(page.getByLabel('厂商 / 注册机构',{exact:true})).toContainText('VMware');
    await expect(page.locator('.section-heading .badge').first()).toHaveText('已完成');
    await page.getByRole('button',{name:'导出结果',exact:true}).click();
    await expect.poll(async()=>fs.readFile(path.join(folder,'export.json'),'utf8').then(JSON.parse).then(x=>x.targetInfo.mac.value).catch(()=>null)).toBe('00:0C:29:01:02:03');
    await page.locator('.target-info').scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath('target-info-light.png'),scale:'css'});
    await page.getByRole('button',{name:'设置',exact:true}).click();
    await page.getByLabel('主题',{exact:true}).selectOption('dark');
    await page.getByLabel('大字模式',{exact:true}).check();
    await page.getByRole('button',{name:'保存设置',exact:true}).click();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(960,720));
    await page.locator('.target-info').scrollIntoViewIfNeeded();
    expect(await page.locator('.target-info').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await page.screenshot({path:info.outputPath('target-info-dark.png'),scale:'css'});
    expect(errors).toEqual([]);
    await app.close();app=await launch();page=await app.firstWindow();
    await page.getByRole('button',{name:/诊断记录/}).click();
    await page.getByRole('button',{name:'查看记录',exact:true}).first().click();
    await expect(page.getByLabel('主机名',{exact:true})).toContainText('fixture-host.example.test');
    await expect(page.getByLabel('厂商 / 注册机构',{exact:true})).toContainText('VMware');
    await page.getByRole('button',{name:'关闭诊断详情',exact:true}).click();
    await page.locator('tr').filter({hasText:'legacy.example'}).getByRole('button',{name:'查看记录'}).click();
    await expect(page.locator('.target-info')).toContainText('此旧记录未保存设备信息');
    const records=(await page.evaluate(()=>window.netTool.load())).history;
    expect(records.find(r=>r.id==='old').targetInfo).toBeUndefined();
  }finally{if(app)await app.close();await fs.rm(folder,{recursive:true,force:true});}
});
