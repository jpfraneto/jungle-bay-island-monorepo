import{dc as s,dD as B,da as S,d8 as W,d7 as L,d9 as r,dv as c,dV as U}from"./index-DD-4HBjz.js";import{t as $}from"./WarningBanner-c8L53pJ2-DXDu6KTN.js";import{j as R}from"./WalletInfoCard-DFt8ndGE-Cwa4gXh7.js";import{n as z}from"./ScreenLayout-DTmQLGPf-DvJ0YHxS.js";import"./ExclamationTriangleIcon-DmHaNEm9.js";import"./ModalHeader-D8-mhjp4-B5ymQYx4.js";import"./ErrorMessage-D8VaAP5m-DL2IbCw_.js";import"./LabelXs-oqZNqbm_-Be0_UsvC.js";import"./Address-BjZb-TIL-BpwAQdm3.js";import"./check-CU58oyGR.js";import"./createLucideIcon-DF80sErR.js";import"./copy-LXsM6s35.js";import"./shared-FM0rljBt-BV0YtF9D.js";import"./Screen-Bp-TN9gb-C0kj7li_.js";import"./index-Dq_xe9dz-BUILY4bR.js";const D=({address:e,accessToken:t,appConfigTheme:n,onClose:d,isLoading:l=!1,exportButtonProps:i,onBack:a})=>r.jsx(z,{title:"Export wallet",subtitle:r.jsxs(r.Fragment,{children:["Copy either your private key or seed phrase to export your wallet."," ",r.jsx("a",{href:"https://privy-io.notion.site/Transferring-your-account-9dab9e16c6034a7ab1ff7fa479b02828",target:"blank",rel:"noopener noreferrer",children:"Learn more"})]}),onClose:d,onBack:a,showBack:!!a,watermark:!0,children:r.jsxs(K,{children:[r.jsx($,{theme:n,children:"Never share your private key or seed phrase with anyone."}),r.jsx(R,{title:"Your wallet",address:e,showCopyButton:!0}),r.jsx("div",{style:{width:"100%"},children:l?r.jsx(O,{}):t&&i&&r.jsx(q,{accessToken:t,dimensions:{height:"44px"},...i})})]})});let K=c.div`
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  text-align: left;
`,O=()=>r.jsx(F,{children:r.jsx(N,{children:"Loading..."})}),F=c.div`
  display: flex;
  gap: 12px;
  height: 44px;
`,N=c.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 16px;
  font-weight: 500;
  border-radius: var(--privy-border-radius-md);
  background-color: var(--privy-color-background-2);
  color: var(--privy-color-foreground-3);
`;function q(e){let[t,n]=s.useState(e.dimensions.width),[d,l]=s.useState(void 0),i=s.useRef(null);s.useEffect((()=>{if(i.current&&t===void 0){let{width:p}=i.current.getBoundingClientRect();n(p)}let o=getComputedStyle(document.documentElement);l({background:o.getPropertyValue("--privy-color-background"),background2:o.getPropertyValue("--privy-color-background-2"),foreground3:o.getPropertyValue("--privy-color-foreground-3"),foregroundAccent:o.getPropertyValue("--privy-color-foreground-accent"),accent:o.getPropertyValue("--privy-color-accent"),accentDark:o.getPropertyValue("--privy-color-accent-dark"),success:o.getPropertyValue("--privy-color-success"),colorScheme:o.getPropertyValue("color-scheme")})}),[]);let a=e.chainType==="ethereum"&&!e.imported&&!e.isUnifiedWallet;return r.jsx("div",{ref:i,children:t&&r.jsxs(M,{children:[r.jsx("iframe",{style:{position:"absolute",zIndex:1},width:t,height:e.dimensions.height,allow:"clipboard-write self *",src:U({origin:e.origin,path:`/apps/${e.appId}/embedded-wallets/export`,query:e.isUnifiedWallet?{v:"1-unified",wallet_id:e.walletId,client_id:e.appClientId,width:`${t}px`,caid:e.clientAnalyticsId,phrase_export:a,...d}:{v:"1",entropy_id:e.entropyId,entropy_id_verifier:e.entropyIdVerifier,hd_wallet_index:e.hdWalletIndex,chain_type:e.chainType,client_id:e.appClientId,width:`${t}px`,caid:e.clientAnalyticsId,phrase_export:a,...d},hash:{token:e.accessToken}})}),r.jsx(g,{children:"Loading..."}),a&&r.jsx(g,{children:"Loading..."})]})})}const le={component:()=>{let[e,t]=s.useState(null),{authenticated:n,user:d}=B(),{closePrivyModal:l,createAnalyticsEvent:i,clientAnalyticsId:a,client:o}=S(),p=W(),{data:m,onUserCloseViaDialogOrKeybindRef:x}=L(),{onFailure:v,onSuccess:w,origin:b,appId:k,appClientId:I,entropyId:j,entropyIdVerifier:C,walletId:_,hdWalletIndex:V,chainType:E,address:y,isUnifiedWallet:T,imported:P,showBackButton:A}=m.keyExport,f=h=>{l({shouldCallAuthOnSuccess:!1}),v(typeof h=="string"?Error(h):h)},u=()=>{l({shouldCallAuthOnSuccess:!1}),w(),i({eventName:"embedded_wallet_key_export_completed",payload:{walletAddress:y}})};return s.useEffect((()=>{if(!n)return f("User must be authenticated before exporting their wallet");o.getAccessToken().then(t).catch(f)}),[n,d]),x.current=u,r.jsx(D,{address:y,accessToken:e,appConfigTheme:p.appearance.palette.colorScheme,onClose:u,isLoading:!e,onBack:A?u:void 0,exportButtonProps:e?{origin:b,appId:k,appClientId:I,clientAnalyticsId:a,entropyId:j,entropyIdVerifier:C,walletId:_,hdWalletIndex:V,isUnifiedWallet:T,imported:P,chainType:E}:void 0})}};let M=c.div`
  overflow: visible;
  position: relative;
  overflow: none;
  height: 44px;
  display: flex;
  gap: 12px;
`,g=c.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 16px;
  font-weight: 500;
  border-radius: var(--privy-border-radius-md);
  background-color: var(--privy-color-background-2);
  color: var(--privy-color-foreground-3);
`;export{le as EmbeddedWalletKeyExportScreen,D as EmbeddedWalletKeyExportView,le as default};
