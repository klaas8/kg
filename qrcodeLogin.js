import {
    execSync
} from "child_process";
import {
    close_api,
    delay,
    send,
    startService
} from "./utils/utils.js";

async function login() {

    const phone = process.env.PHONE
    const code = process.env.CODE

    if (!phone || !code) {
        throw new Error("未配置")
    }
    const api = startService()
    await delay(2000)

    const userinfo = []

    try {
        // 手机号登录请求
        const result = await send(`/login/cellphone?mobile=${phone}&code=${code}`, "GET", {})
        if (result.status === 1) {
            console.log("登录成功！")
            console.log("第一行是token,第二行是userid")
            console.log(result.data.token)
            console.log(result.data.userid)
            userinfo.push({
                userid: result.data.userid,
                token: result.data.token
            })
            const userinfoJSON = JSON.stringify(userinfo)
            try {
                execSync(`gh secret set USERINFO -b'${userinfoJSON}' --repo ${process.env.GITHUB_REPOSITORY}`);
                console.log("secret <USERINFO> 更改成功")
                const current = await getBeijingDateTime();
                execSync('git config --global user.email "github-actions[bot]@users.noreply.github.com"');
                execSync('git config --global user.name "github-actions[bot]"');
                execSync(`echo "预计**${current.twoMonthsLater}**到期" > README.md`);
                execSync('git add -A');
                try {
                    execSync('git commit -m "chore: 更新 [skip ci]"');
                    execSync('git push --quiet --force-with-lease');
                } catch (commitError) {}
            } catch (error) {
                console.log("自动写入出错，登录信息如下，请手动添加到secret USERINFO")
                console.log(userinfoJSON)
            }
        } else if (result.error_code === 34175) {
            throw new Error("暂不支持多账号绑定手机登录")
        } else {
            console.log("响应内容")
            console.dir(result, {
                depth: null
            })
            throw new Error("登录失败！请检查")
        }
    } finally {
        close_api(api)
    }

    if (api.killed) {
        process.exit(0)
    }
}

async function getBeijingDateTime() {
    const getBeijingTime = () => {
        const now = new Date();
        return new Date(now.getTime() + (8 * 60 * 60 * 1000));
    };
    const current = getBeijingTime();
    const currentStr = `${current.getUTCFullYear()}-${(current.getUTCMonth() + 1).toString().padStart(2, '0')}-${current.getUTCDate().toString().padStart(2, '0')}`;
    const future = new Date(current);
    future.setUTCMonth(future.getUTCMonth() + 2);
    const futureStr = `${future.getUTCFullYear()}-${(future.getUTCMonth() + 1).toString().padStart(2, '0')}-${future.getUTCDate().toString().padStart(2, '0')}`;
    return {
        currentBeijing: currentStr,
        twoMonthsLater: futureStr,
        currentDate: current,
        futureDate: future
    };
}

login()