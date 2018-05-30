import fs from "fs";
import path from "path";
import cp from "child_process";

export function walkDirs(dir: string, forEach: { (file: string, root: string) }, filter: { (file: string): boolean } = file => true) {
    let willChecked = [dir];
    while (willChecked.length) {
        let chk = willChecked.pop();
        if (!filter(chk)) {
            continue;
        }
        let stat = fs.statSync(chk);
        if (stat.isDirectory()) {
            let files = fs.readdirSync(chk);
            files.forEach(file => {
                willChecked.push(path.join(chk, file));
            })
        } else {
            forEach(chk, dir);
        }
    }
}

/**
 * 执行svn命令
 */
export function svnExec(cmd: string, opt: cp.SpawnSyncOptions = { stdio: 'pipe' }, ...arg: string[]) {
    console.log(`开始尝试执行: svn ${cmd} ${arg.join(" ")}`);
    let args = [];
    args[0] = cmd;
    args[1] = "--username";
    args[2] = "buider";
    args[3] = "--password";
    args[4] = "buider";
    for (let i = 0; i < arg.length; i++) {
        args.push(arg[i]);
    }
    let obj = cp.spawnSync("svn", args, opt);
    if (obj.status) {
        throw Error(`执行失败: svn ${cmd} ${arg.join(" ")}`);
    }
    console.log(`执行完成: svn ${cmd} ${arg.join(" ")}`);
    return obj;
}