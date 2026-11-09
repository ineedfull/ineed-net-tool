export const TOOL_NAMES = {
  scan:'IP 探测', ping:'Ping', route:'路由', dns:'DNS 查询', ports:'端口扫描',
  speed:'下载测速', quality:'链路质量', certificate:'证书检查',
};
export const EXTRA_TOOLS = ['dns','ports','speed','quality','certificate'];
export const TOOL_DEFAULTS = {
  dns:{target:'example.com',recordType:'A',server:'',timeout:3000},
  ports:{target:'127.0.0.1',ports:'22,80,443,1883,3306,5432,8080',concurrency:64,timeout:1000},
  speed:{target:'',duration:15,maxMiB:64,timeout:5000},
  quality:{target:'127.0.0.1',method:'icmp',port:443,count:20,interval:1000,timeout:1000},
  certificate:{target:'example.com',port:443,servername:'',warnDays:30,timeout:5000},
};
