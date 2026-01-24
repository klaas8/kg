import {
    execSync
} from "child_process";
import {
    close_api,
    delay,
    send,
    startService
} from "./utils/utils.js";

async function qrcode() {

    // 启动服务
    const api = startService()
    await delay(2000)
    let qrcode = ""
    const userinfo = []
    const args = process.argv.slice(2);
    const number = parseInt(process.env.NUMBER || args[0] || "1")
    const pat = process.env.PAT
    try {
        for (let i = 0; i < number; i++) {
            // 二维码
            const result = await send(`/login/qr/key?timestrap=${Date.now()}`, "GET", {})
            if (result.status === 1) {
                qrcode = result.data.qrcode
                const img_base64 = result.data.qrcode_img;
                console.log("二维码链接如下, 请在浏览器打开使用APP扫描并确认登录")
                const imgUrl = await uploadToImgBB(img_base64);
                if (imgUrl) {
                console.log(imgUrl);
                } else {
                    const chunkSize = 1000;
                    for (let i = 0; i < img_base64.length; i += chunkSize) {
                        console.log(img_base64.slice(i, i + chunkSize));
                    }
                }
            } else {
                console.log("响应内容")
                console.dir(result, {
                    depth: null
                })
                throw new Error("请求出错")
            }
            console.log("正在等待，请扫描二维码并确定登录")
            // 登录
            for (let i = 0; i < 25; i++) {
                const timestrap = Date.now();
                const res = await send(`/login/qr/check?key=${qrcode}&timestrap=${timestrap}`, "GET", {})
                const status = res?.data?.status
                switch (status) {
                    case 0:
                        console.log("二维码已过期")
                        break

                    case 1:
                        // console.log("未扫描二维码")
                        break

                    case 2:
                        // console.log("二维码未确认，请点击确认登录")
                        break
                    case 4:
                        console.log("登录成功！")
                        userinfo.push({
                            userid: res.data.userid,
                            token: res.data.token
                        })
                        break;
                    default:
                        console.log("请求出错")
                        console.dir(res, {
                            depth: null
                        })
                }
                if (status == 4 || status == 0) {
                    break
                }
                if (i == 24) {
                    console.log("等待超时\n")
                    break
                }
                await delay(5000)
            }
        }
        const userinfoJSON = JSON.stringify(userinfo)
        if (pat) {
            try {
                execSync(`gh secret set USERINFO -b'${userinfoJSON}' --repo ${process.env.GITHUB_REPOSITORY}`);
                console.log("secret <USERINFO> 更改成功")
            } catch (error) {
                console.log("自动写入出错，登录信息如下，请手动添加到secret USERINFO")
                console.log(userinfoJSON)
            }
        } else {
            console.log("登录信息如下，把它添加到secret USERINFO 即可")
            console.log(userinfoJSON)
        }
    } finally {
        close_api(api)
    }

    if (api.killed) {
        process.exit(0)
    }
}

async function uploadToImgBB(base64Data) {
    const apiKey = process.env.API;
    if (apiKey) {
        const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
        const formData = new FormData();
        formData.append('key', apiKey);
        formData.append('image', cleanBase64);
        try {
            const response = await fetch('https://api.imgbb.com/1/upload', {
                method: 'POST',
                body: formData
            });
            const result = await response.json();
            if (result.success) {
                return result.data.url;
            }
        } catch (error) {
            console.error('上传出错:', error.message);
        }
    }
    return null;
}

qrcode()