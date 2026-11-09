import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root=fileURLToPath(new URL('../..',import.meta.url));
const require=createRequire(import.meta.url);
const executablePath=process.env.ELECTRON_BINARY||require('electron');

test('large scan UI paginates complete results, exports, filters and restores history',async({},info)=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'nettool-large-ui-')); let app;
  const launch=()=>electron.launch({executablePath,args:[root],env:{...process.env,NET_TOOL_TEST_DATA:folder}});
  try {
    app=await launch(); let page=await app.firstWindow();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    // Replace only native probes in this isolated test process. Exercise real scheduling, IPC and SQLite.
    await app.evaluate(async({app,dialog},folder)=>{
      const {createRequire}=process.getBuiltinModule('node:module');
      const require=createRequire(app.getAppPath()+'/package.json');
      const {NetworkTasks}=require('./electron/network.cjs');
      const scan=NetworkTasks.prototype.scan;
      NetworkTasks.prototype.scan=async function(task,addresses){
        this.scanProbes={ping:async(ip,timeout,signal)=>{
          await new Promise(resolve=>setTimeout(resolve,2));
          if(signal.aborted)throw new Error('stopped');
          return {ip,status:ip.endsWith('.1')?'reachable':'no-response',ms:ip.endsWith('.1')?1:null,method:'ICMP',detail:'isolated deterministic UI test'};
        }};
        return scan.call(this,task,addresses);
      };
      dialog.showSaveDialog=async()=>({canceled:false,filePath:folder+'/export.json'});
    },folder);
    await page.getByRole('button',{name:'IP 地址探测',exact:true}).click();
    await page.getByLabel('scan目标').fill('0.0.0.0/0');
    await expect(page.getByRole('button',{name:'开始探测',exact:true})).toBeDisabled();
    await expect(page.getByRole('alert')).toContainText('65,536');
    await page.getByLabel('scan目标').fill('127.0.0.0/16');
    await expect(page.getByLabel('扫描范围预览')).toContainText('65,534');
    await page.getByRole('button',{name:'紧凑网格',exact:true}).click();
    await expect(page.locator('.scan-address-cell')).toHaveCount(255);
    await page.getByLabel('地址区块').selectOption('127.0.255');
    await expect(page.locator('.scan-address-cell').last()).toHaveAttribute('aria-label',/127\.0\.255\.254/);
    await page.getByLabel('scan目标').fill('127.0.0.0/19');
    await page.getByLabel('扫描并发数').fill('32');
    await page.getByRole('button',{name:'开始探测',exact:true}).click();
    await expect(page.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'暂停',exact:true}).click();
    await expect(page.locator('.section-heading .badge').first()).toHaveText('已暂停');
    await page.getByRole('button',{name:'继续',exact:true}).click();
    await expect(page.locator('.section-heading .badge').first()).toHaveText('已完成',{timeout:30000});
    await expect(page.locator('.scan-progress')).toContainText('8190 / 8190');
    await expect(page.locator('.scan-progress')).toContainText('32 / 32 批');
    await page.getByRole('button',{name:'表格',exact:true}).click();
    await expect(page.locator('.result-panel tbody tr')).toHaveCount(100);
    await page.getByLabel('结果页码').selectOption('82');
    await expect(page.locator('.result-panel tbody tr')).toHaveCount(90);
    await expect(page.locator('.result-panel tbody tr').last()).toContainText('127.0.31.254');
    await page.getByLabel('结果状态筛选').selectOption('reachable');
    await expect(page.locator('.result-panel tbody tr')).toHaveCount(32);
    await page.getByRole('button',{name:'导出结果',exact:true}).click();
    await expect.poll(async()=>fs.readFile(path.join(folder,'export.json'),'utf8').then(JSON.parse).then(x=>x.rows.length).catch(()=>0)).toBe(8190);
    const state=await page.evaluate(()=>window.netTool.load());
    expect(state.history[0].rows).toHaveLength(8190);
    await page.getByLabel('结果状态筛选').selectOption('all');
    await page.getByRole('button',{name:'设置',exact:true}).click();
    await page.getByLabel('主题',{exact:true}).selectOption('dark');
    await page.getByLabel('大字模式',{exact:true}).check();
    await page.getByRole('button',{name:'保存设置',exact:true}).click();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(960,720));
    await page.getByLabel('结果分页').scrollIntoViewIfNeeded();
    expect(await page.locator('.page-content').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await page.screenshot({path:info.outputPath('large-scan-dark.png'),scale:'css'});
    expect(errors).toEqual([]);
    await app.close();app=await launch();page=await app.firstWindow();
    await page.getByRole('button',{name:/诊断记录/}).click();
    await page.getByRole('button',{name:'查看记录',exact:true}).click();
    await expect(page.locator('.result-scroll tbody tr')).toHaveCount(100);
    await page.getByLabel('结果页码').selectOption('82');
    await expect(page.locator('.result-scroll tbody tr')).toHaveCount(90);
    await page.getByRole('button',{name:'紧凑网格',exact:true}).click();
    await page.getByLabel('地址区块').selectOption('127.0.31');
    await expect(page.locator('.scan-address-cell')).toHaveCount(255);
  } finally {if(app)await app.close();await fs.rm(folder,{recursive:true,force:true});}
});
