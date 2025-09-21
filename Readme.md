# 🌹 Syrian Martyrs Telegram Bot - Vercel Edition

A serverless Telegram bot for managing Syrian Coast martyrs gallery, built with Node.js and deployed on Vercel.

## 🚀 Quick Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/syrian-martyrs-vercel&env=BOT_TOKEN,ADMIN_USER_ID,MONGODB_URI)

## 🌟 Features

- 📝 **Add new martyrs** with complete information
- 🖼️ **Photo upload** and management
- 👥 **User session** management
- 🔍 **Admin review** system
- 📊 **Request tracking** for users
- 🛡️ **Admin-only** approval/rejection
- 🌐 **Arabic language** support
- ⚡ **Serverless** - runs only when needed
- 🆓 **100% Free** on Vercel

## 📁 Project Structure

```
syrian-martyrs-vercel/
├── api/
│   └── webhook.js          # Main serverless function
├── package.json            # Dependencies
├── vercel.json            # Vercel configuration
├── .env                   # Environment variables (local only)
├── .gitignore             # Git ignore rules
└── README.md              # This file
```

## 🔧 Environment Variables

Set these in Vercel Dashboard → Project Settings → Environment Variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `BOT_TOKEN` | Telegram Bot Token | `123456789:ABCdef...` |
| `ADMIN_USER_ID` | Telegram User ID of admin | `5679396406` |
| `MONGODB_URI` | MongoDB connection string | `mongodb+srv://user:pass@cluster...` |
| `NODE_ENV` | Environment | `production` |

## 🚀 Deployment Steps

### 1. Fork this repository

### 2. Deploy to Vercel
1. Go to [vercel.com](https://vercel.com)
2. Sign in with GitHub
3. Click "New Project"
4. Import your forked repository
5. Add environment variables
6. Click "Deploy"

### 3. Set up Telegram Webhook
After deployment, visit this URL in your browser:
```
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://your-app.vercel.app/webhook
```

### 4. Test your bot
Send `/start` to your bot in Telegram!

## 📱 Bot Commands

### User Commands
- `/start` - Initialize bot and show main menu
- `إضافة شهيد جديد` - Start adding new martyr
- `عرض ط