# FlexNet Backend — Deploy Guide

## 本地测试
```bash
cd backend
npm install
node server.js
```
打开 http://localhost:3000 → 实验页面
打开 http://localhost:3000/admin.html → 管理后台（默认 admin / changeme）

## 部署到 Render

### 步骤 1: 推送到 GitHub
把 `backend/` 目录整个推到你的 GitHub 仓库。

### 步骤 2: 在 Render 创建 Web Service
1. 去 https://dashboard.render.com → New → Web Service
2. 连接你的 GitHub 仓库
3. Root Directory 设为 `backend`
4. Build Command: `npm install`
5. Start Command: `npm start`
6. 点 Create Web Service

### 步骤 3: 设置环境变量
在 Render Dashboard → Environment 中设置：

| 变量 | 值 |
|------|-----|
| `ADMIN_USER` | 你要的管理员用户名 |
| `ADMIN_PASS_HASH` | 密码哈希（见下方生成方法） |
| `UPLOAD_TOKEN` | 和前端一致的 token |
| `SESSION_SECRET` | 随机长字符串 |

**生成密码哈希**：
```bash
node -e "const c=require('crypto'); console.log(c.scryptSync('你的密码','flexnet_salt',64).toString('hex'))"
```

### 步骤 4: 更新前端 token
如果改了 UPLOAD_TOKEN，记得同步修改 `public/index.html` 里的 AUTH_TOKEN。

## API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/` | GET | 实验页面 |
| `/admin.html` | GET | 管理后台 |
| `/api/upload` | POST | 接收实验数据 |
| `/api/admin/login` | POST | 管理员登录 |
| `/api/admin/logout` | POST | 管理员登出 |
| `/api/admin/submissions` | GET | 数据列表 |
| `/api/admin/download/:file` | GET | 下载单个 CSV |
| `/api/admin/download-all` | GET | 下载合并 CSV |
| `/api/admin/submissions/:file` | DELETE | 删除提交 |
