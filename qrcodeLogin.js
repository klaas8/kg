import { createRequire } from 'module'
import fs from 'node:fs'
import { close_api, delay, send, startService } from "./utils/utils.js";
import { printGreen, printMagenta, printRed, printYellow } from "./utils/colorOut.js";
import { summarizeResponse } from "./utils/safeLog.js";
import { upsertUser, saveUserinfo } from "./utils/userinfo.js";

const require = createRequire(import.meta.url)
const QRCode = require('./api/node_modules/qrcode')

// GitHub Actions 运行环境下，step summary 文件路径由该变量提供
const SUMMARY_FILE = process.env.GITHUB_STEP_SUMMARY
const QR_DIR = './qr'
const KEYS_FILE = './qrkeys.json'

/**
 * 渲染 QR 矩阵为纯 ASCII 文本（无 ANSI 转义码），用于实时日志扫码
 * @param {string} url
 * @returns {string}
 */
function renderQrAscii(url) {
  const qr = QRCode.create(url, { margin: 2 })
  const modules = qr.modules
  const size = modules.size
  let ascii = ''
  for (let r = 0; r < size; r++) {
    let line = ''
    for (let c = 0; c < size; c++) {
      line += modules.get(r, c) ? '██' : '  '
    }
    ascii += line + '\n'
  }
  return ascii
}

/**
 * 向 GitHub Step Summary 追加内容（本地或非 Actions 环境自动跳过）
 * @param {string} markdown
 */
function appendSummary(markdown) {
  if (!SUMMARY_FILE) return
  try {
    fs.appendFileSync(SUMMARY_FILE, markdown)
  } catch {
    // 写入摘要失败不影响主流程
  }
}

/**
 * 生成并展示单个二维码
 * - 日志: 实时输出 ASCII 二维码（用户可在运行日志直接扫码）
 * - Summary: 以真实 PNG 图片（data URI）嵌入运行摘要，扫码页可直接查看
 * - PNG: 保存为文件，供 artifact 下载
 * @param {string} url
 * @param {number} index 从 1 开始
 * @param {number} total
 */
async function buildQr(url, index, total) {
  const ascii = renderQrAscii(url)
  const header = total > 1 ? `（第 ${index}/${total} 个账号）` : ''

  // 1) 实时日志 ASCII（可在运行日志中直接扫码）
  printMagenta(`\n请使用酷狗音乐 APP 扫描下方二维码登录${header}`)
  console.log(ascii)
  printMagenta('如二维码无法扫描，请复制此链接到浏览器打开扫码：')
  console.log(url)
  console.log('')

  // 2) 生成 PNG 文件（artifact 下载 + Summary 内嵌图片）
  fs.mkdirSync(QR_DIR, { recursive: true })
  await QRCode.toFile(`${QR_DIR}/qr-${index}.png`, url, { width: 320, margin: 2 })

  // 3) 在运行摘要（Summary）中嵌入真实可扫的二维码图片
  const dataUrl = await QRCode.toDataURL(url, { width: 320, margin: 2 })
  appendSummary([
    `## 🎵 酷狗音乐扫码登录${header}`,
    '',
    '请使用 **酷狗音乐 APP** 扫描下方二维码登录（图片可在运行摘要页直接查看）：',
    '',
    `<img src="${dataUrl}" alt="酷狗扫码登录二维码${header}" width="320" />`,
    '',
    '如图片无法加载，可复制以下链接到浏览器打开：',
    '',
    url,
    '',
    '<details><summary>字符版二维码（备用）</summary>',
    '',
    '```',
    ascii,
    '```',
    '',
    '</details>',
    '',
    '---',
    '',
  ].join('\n'))
}

/** 解析账号数量 */
function resolveNumber() {
  const args = process.argv.slice(3) // 跳过 node、脚本名、模式参数
  return parseInt(process.env.NUMBER || args[0] || "1")
}

/**
 * 模式一：生成二维码并写入运行摘要，随后立即结束 step
 * 拆成独立 step 的目的是——GitHub 会在 step 结束后刷新 Summary 页，
 * 这样用户在“等待扫码”step 期间就能在 Summary 看到真实二维码图片去扫码。
 */
async function genMode() {
  const api = startService()
  await delay(2000)
  const USERINFO = process.env.USERINFO
  const APPEND_USER = process.env.APPEND_USER
  const userinfo = (USERINFO && APPEND_USER == "是") ? JSON.parse(USERINFO) : []
  const number = resolveNumber()
  const keys = []
  try {
    for (let n = 0; n < number; n++) {
      const result = await send(`/login/qr/key?timestrap=${Date.now()}`, "GET", {})
      if (result.status === 1) {
        const qrcode = result.data.qrcode
        const qrUrl = `https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=${qrcode}`
        keys.push(qrcode)
        await buildQr(qrUrl, n + 1, number)
      } else {
        printRed("响应内容")
        console.dir(summarizeResponse(result), { depth: null })
        throw new Error("请求出错")
      }
    }
    fs.writeFileSync(KEYS_FILE, JSON.stringify({ number, keys }))
  } finally {
    close_api(api)
  }

  printMagenta(`\n已生成 ${number} 个二维码。本步骤结束后，请打开本次运行的“Summary（摘要）”页面，`)
  printMagenta(`在页面中扫描二维码图片；随后工作流会自动进入“等待扫码”步骤完成登录。`)
}

/**
 * 模式二：读取已生成的二维码密钥，轮询等待用户扫码确认
 */
async function waitMode() {
  const api = startService()
  await delay(2000)
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'))
  } catch {
    throw new Error("未找到二维码密钥文件，请确认已先运行“生成并展示二维码”步骤")
  }
  const { number, keys } = parsed
  const USERINFO = process.env.USERINFO
  const APPEND_USER = process.env.APPEND_USER
  const userinfo = (USERINFO && APPEND_USER == "是") ? JSON.parse(USERINFO) : []

  try {
    for (let n = 0; n < number; n++) {
      const qrcode = keys[n]
      printMagenta(`\n正在等待第 ${n + 1}/${number} 个账号扫码登录...`)
      let loggedIn = false
      for (let i = 0; i < 30; i++) {
        const timestrap = Date.now();
        const res = await send(`/login/qr/check?key=${qrcode}&timestrap=${timestrap}`, "GET", {})
        const status = res?.data?.status
        switch (status) {
          case 0:
            printYellow("二维码已过期，请重新运行工作流生成新二维码")
            break

          case 1:
            // 未扫描二维码
            break

          case 2:
            // 二维码未确认，请点击确认登录
            break

          case 4:
            printGreen("登录成功！")
            upsertUser(userinfo, { userid: res.data.userid, token: res.data.token }, APPEND_USER == "是")
            loggedIn = true
            break

          default:
            printRed("请求出错")
            console.dir(summarizeResponse(res), { depth: null })
        }
        if (loggedIn || status == 0) {
          break
        }
        if (i == 29) {
          printRed("等待超时\n")
        }
        await delay(5000)
      }
    }
    saveUserinfo(userinfo)
  } finally {
    close_api(api)
  }
}

const mode = process.argv[2] || 'gen'
if (mode === 'wait') {
  waitMode()
} else {
  genMode()
}
