import { walkDirs, svnExec } from "./Helper";
import gm from "gm";
import Koa from "koa";
import * as path from "path";
import * as fs from "fs";
import archiver from "archiver";

interface Size {
    /**
     * 图片宽度
     */
    width: number;
    /**
     * 图片高度
     */
    height: number;
}

interface SizeInfo extends Size {

    /**
     * 长宽比
     */
    aspectRatio: number;

    /**
     * 候选图片列表
     */
    candidates: Candidate[];
}

interface Candidate {
    uri: string;

    /**
     * 比例匹配度方差
     */
    variance: number;

    /**
     * 面积匹配度方差
     */
    areaVariance: number;
    /**
     * 尺寸
     */
    size: string;
}

/**
 * 图片信息
 */
interface ImageInfo extends Size {

    /**
     * 相对路径
     */
    uri: string;
}


function getAspectRatio(size: Size) {
    return size.width / size.height;
}

function getArea(size: Size) {
    return size.width * size.height;
}

async function getImgInfos(baseDir: string) {
    let list = [] as ImageInfo[];
    walkDirs(baseDir, (file, root) => {
        let res = path.parse(file);
        if (res.ext == ".png") {
            let info = {
                uri: path.relative(root, file).replace(/\\/g, "/")
            } as ImageInfo;
            list.push(info);
        }
    }, (file) => path.parse(file).base != ".svn");
    for (let i = 0; i < list.length; i++) {
        const info = list[i];
        try {
            let size = await getSize(path.join(baseDir, info.uri));
            info.width = size.width;
            info.height = size.height;
        } catch (e) {
            console.error(e);
        }
    }
    return list;
}

function getSize(npath) {
    return new Promise<gm.Dimensions>((resolve, reject) => {
        gm(npath)
            .size((err, data) => {
                if (err) {
                    return reject(err);
                }
                return resolve(data);
            })
    });
}


async function start() {
    imgList = await getImgInfos(baseDir);
    const app = new Koa();
    app.use(async (ctx, next) => {
        let handler = handlers[ctx.path.substr(1)];
        if (handler) {
            await handler(ctx);
        } else {
            ctx.throw(404);
        }
        await next();
    })

    app.listen(port);
}

let imgList: ImageInfo[];
let clientImgList: string;

const handlers = {} as { [handle: string]: { (ctx: Koa.Context): Promise<any> } };

handlers.download = async ctx => {
    let uriStr = decodeURIComponent(ctx.querystring);
    let uris = JSON.parse(uriStr) as [string, number, number, string][];
    ctx.set('Content-disposition', `attachment;filename=${Date.now()}.zip`);
    let arch = archiver("zip", { zlib: { level: 9 } });
    for (let i = 0; i < uris.length; i++) {
        let [uri, width, height, ext] = uris[i];
        ext = ext || "png";
        arch.append(gm(path.join(baseDir, uri)).resize(width, height).setFormat(ext).stream(), { name: `${width}_${height}_${i}.${ext}` });
    }
    ctx.body = arch;
    arch.finalize();
}

handlers.update = async ctx => {
    //清理
    svnExec("cleanup", undefined, baseDir);
    //更新
    svnExec("update", { stdio: "pipe", cwd: baseDir }, baseDir);
    //重新构建图片列表数据
    imgList = await getImgInfos(baseDir);
    clientImgList = undefined;
    printImgList(ctx);
}

handlers.getList = async ctx => {
    printImgList(ctx);
}

function printImgList(ctx) {
    ctx.type = "json";
    if (!clientImgList) {
        clientImgList = JSON.stringify(imgList)
    }
    ctx.body = clientImgList;
}

handlers.img = async ctx => {
    let uri = decodeURIComponent(ctx.querystring);
    const resp = ctx.response;
    resp.type = "png";
    resp.body = fs.createReadStream(path.join(baseDir, uri));
}

handlers.search = async ctx => {
    if (!imgList) {
        imgList = await getImgInfos(baseDir);
    }
    //根据指定参数，搜索图片
    let sizeStr = decodeURIComponent(ctx.querystring);
    let arr = sizeStr.split("|") as string[];
    let sizes = arr.map<SizeInfo>((item) => {
        let subArr = item.split("×");
        //检查尺寸
        let [width, height] = subArr;
        let size = { width: +width, height: +height } as SizeInfo;
        size.aspectRatio = getAspectRatio(size);
        return size;
    });

    //进行尺寸搜索
    for (let i = 0; i < imgList.length; i++) {
        const img = imgList[i];
        const imgAR = getAspectRatio(img);
        const imgArea = getArea(img);
        const uri = img.uri;
        const sizeStr = `${img.width}×${img.height}`;
        for (let j = 0; j < sizes.length; j++) {
            const size = sizes[j];
            //检查尺寸匹配度
            let sizeAR = size.aspectRatio;
            let area = getArea(size);
            let variance = (imgAR - sizeAR) ** 2;
            if (variance < threshold) {
                let areaVariance = (area / imgArea - 1) ** 2;
                if (areaVariance < areaThreshold) {
                    let candidates = size.candidates;
                    if (!candidates) {
                        size.candidates = candidates = [];
                    }
                    candidates.push({
                        variance,
                        areaVariance,
                        uri,
                        size: sizeStr
                    })
                    break;
                }
            }
        }
    }

    //根据尺寸，按长宽比偏移方差*面积偏移方差进行排序
    for (let j = 0; j < sizes.length; j++) {
        const size = sizes[j];
        const candidates = size.candidates;
        if (candidates && candidates.length) {
            candidates.sort((a, b) => a.variance * a.areaVariance - b.variance * b.areaVariance);
        }
    }

    ctx.body = JSON.stringify(sizes);
}

handlers[""] = handlers["index.html"] = async ctx => {
    const resp = ctx.response;
    resp.type = "html";
    resp.body = fs.createReadStream(path.join(__dirname, "../index.html"));
}

let args = process.argv;
const baseDir = args[2];
let port = args[3] || 8315;
let threshold = +args[4] || .0025; // 默认 5% 的偏移值的平方
let areaThreshold = +args[5] || .04; // 20% 面积差值的平方

if (!baseDir) {
    console.error(`必须传基础文件夹`);
    process.exit(1);
}
start();