/*
 * @Author: zhangshouchang
 * @Date: 2024-09-05 17:00:14
 * @LastEditors: zhangshouchang
 * @LastEditTime: 2024-09-18 23:42:07
 * @Description: File description
 */
// 后面删掉这个
require("dotenv").config();
const path = require("path");
const fsExtra = require("fs-extra");
const { readFile } = require("../services/fileService");
const { createTableImages, getAllImageInfo, getAllImageInfoByPage, getCertainMonthImageInfoByPage, saveImageInfo } = require("../models/imageModel");
const { stringToTimestamp } = require("../utils/formatTime");
const { isImage, isDuplicate, formatImage, rollbackOperation, calculateImageHash, extractImageMetadata } = require("../services/imageService");

//源文件目录
const uploadFolder = path.join(__dirname, "..", "..", process.env.UPLOADS_DIR);
// 存放处理成功图片的源图片文件夹
const originalFolder = path.join(__dirname, "..", "..", process.env.PROCESSED_ORIGINAL_IMAGE_DIR);
// 重复图片存放目录
const duplicateFolder = path.join(__dirname, "..", "..", process.env.DUPLICATE_IMAGE_DIR);
// 格式化图片后缀名
const imgExtension = process.env.PROCESSED_IMAGE_TARGET_EXTENSION;
// 转换大图目录
const bigImageFolder = path.join(__dirname, "..", "..", process.env.PROCESSED_BIG_IMAGE_DIR);
// 转换小图目录
const smallImageFolder = path.join(__dirname, "..", "..", process.env.PROCESSED_SMALL_IMAGE_DIR);

// // 确保目标文件夹存在 若不存在 会自动创建
fsExtra.ensureDirSync(bigImageFolder);
fsExtra.ensureDirSync(smallImageFolder);
fsExtra.ensureDirSync(duplicateFolder);

// 图片压缩处理入库
async function processAndSaveImage() {
  let processCount = 0;
  try {
    // 读取上传文件夹
    let files = await readFile(uploadFolder);
    // 过滤出图片文件
    imageFiles = files.filter(isImage);
    if (!imageFiles || !imageFiles.length) {
      console.log("无图片文件需要处理");
      return;
    }
    console.log("文件夹中的图片:", files);
    //新建images数据表(如果不存在)
    createTableImages();
    // 获取数据库中所有已存储图片信息
    const existingImages = getAllImageInfo();
    // 进行图片文件处理
    for (const file of imageFiles) {
      //  原文件路径
      const sourceFilePath = path.join(uploadFolder, file);
      // 判断数据库中是否已存在相同图片信息(在这之前应该对文件夹内部进行一次去重 这个逻辑后面补上)
      const isAlreadyExist = await isDuplicate(sourceFilePath, existingImages);
      //   已存在 则不再进行图片处理 并将其移至重复图片文件夹存放
      if (isAlreadyExist) {
        const duplicateFilePath = path.join(duplicateFolder, path.basename(sourceFilePath));
        await fsExtra.move(sourceFilePath, duplicateFilePath, { overwrite: true });
        console.log(`重复图片已移动至：${duplicateFilePath}`);
      } else {
        // 获取文件名(不带后缀)
        const fileName = path.parse(sourceFilePath).name;
        // 图片格式化
        try {
          //  格式化大图
          var bigFilePath = path.join(bigImageFolder, `${fileName}.${imgExtension}`);
          await formatImage([sourceFilePath, "-quality", "60", bigFilePath]);
          // 格式化小图
          var smallFilePath = path.join(smallImageFolder, `${fileName}.${imgExtension}`);
          await formatImage([sourceFilePath, "-quality", "50", "-resize", "800x", smallFilePath]);
        } catch (err) {
          console.log(`图片文件 ${file} 格式转换失败: ${err}`);
          //将可能已转化成功的图片文件删除并跳出当前循环
          rollbackOperation(bigFilePath);
          rollbackOperation(smallFilePath);
          continue;
        }
        // 获取图片元数据
        const exifData = await extractImageMetadata(sourceFilePath);
        // console.log("元数据：", exifData.CreateDate);
        let imageData = {
          bigPath: path.join(`/${process.env.PROCESSED_BIG_IMAGE_DIR}`, `${fileName}.${imgExtension}`),
          smallPath: path.join(`/${process.env.PROCESSED_SMALL_IMAGE_DIR}`, `${fileName}.${imgExtension}`),
          creationDate: exifData.CreateDate ? stringToTimestamp(exifData.CreateDate.rawValue) : "",
        };
        console.log("imageData:", imageData);
        // 获取图片哈希值
        const imageHash = await calculateImageHash(sourceFilePath);
        imageData.hash = imageHash;
        //将图片数据插入数据表
        try {
          await saveImageInfo(imageData);
          // console.log(`图片信息插入数据表成功，图片地址：${bigFilePath}`);
          // 全部操作成功后 将源图片移至original目录
          const originalFilePath = path.join(originalFolder, path.basename(sourceFilePath));
          await fsExtra.move(sourceFilePath, originalFilePath, { overwrite: true });
          // console.log(`上传图片已移动至：${originalFilePath}`);
          processCount++;
        } catch (err) {
          console.log(`图片信息插入数据表发生错误，图片地址：${bigFilePath}`, err);
        }
      }
    }
  } catch (err) {
    console.log("图片处理出错：", err);
  } finally {
    console.log(`图片操作结束，成功处理${processCount}张`);
  }
}

// 获取所有图片信息
function getAllImages(req, res) {
  // 资源地址 用于图片访问地址拼接
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  try {
    // 获取数据库中所有已存储图片信息
    const images = getAllImageInfo();
    // 将 imagesWithBaseUrl 数组转换成 JSON 格式，并将其发送给客户端
    // res.json(images);

    // 为每张图片添加服务器基本路径
    const imagesWithBaseUrl = images.map((image) => {
      return {
        ...image,
        bigPath: `${baseUrl}${image.bigPath}`,
        smallPath: `${baseUrl}${image.smallPath}`,
      };
    });
    res.json(imagesWithBaseUrl);
    // res.json({
    //     success:true,
    //     data:imagesWithBaseUrl
    // })
  } catch (err) {
    console.log("查询全部图片信息表出错：", err);
    res.status(500).json({ error: "internal server error" });
  }
}

// 分页获取所有图片信息
function getAllImagesByPage(req, res) {
  const { pageSize, pageNo } = req.body;
  // 资源地址 用于图片访问地址拼接
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  try {
    // 分页获取数据库中所有已存储图片信息
    const queryResult = getAllImageInfoByPage({ pageSize, pageNo });
    // 将 imagesWithBaseUrl 数组转换成 JSON 格式，并将其发送给客户端
    // res.json(images);

    // 为每张图片添加服务器基本路径
    const imagesWithBaseUrl = queryResult.data.map((image) => {
      return {
        ...image,
        bigPath: `${baseUrl}${image.bigPath}`,
        smallPath: `${baseUrl}${image.smallPath}`,
      };
    });
    res.json({ data: imagesWithBaseUrl, total: queryResult.total });
    // res.json({
    //     success:true,
    //     data:imagesWithBaseUrl
    // })
  } catch (err) {
    console.log("分野查询图片信息表出错：", err);
    res.status(500).json({ error: "internal server error" });
  }
}

//分页获取具体某个月图片信息
function getCertainMonthImagesByPage(req, res) {
  const { pageSize, pageNo, month: creationDate } = req.body;
  // 资源地址 用于图片访问地址拼接
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  try {
    // 分页获取数据库中具体某个月已存储图片信息
    const queryResult = getCertainMonthImageInfoByPage({ pageSize, pageNo, creationDate });
    // 将 imagesWithBaseUrl 数组转换成 JSON 格式，并将其发送给客户端
    // res.json(images);

    // 为每张图片添加服务器基本路径
    const imagesWithBaseUrl = queryResult.data.map((image) => {
      return {
        ...image,
        bigPath: `${baseUrl}${image.bigPath}`,
        smallPath: `${baseUrl}${image.smallPath}`,
      };
    });
    res.json({ data: imagesWithBaseUrl, total: queryResult.total });
    // res.json({
    //     success:true,
    //     data:imagesWithBaseUrl
    // })
  } catch (err) {
    console.log("分野查询图片信息表出错：", err);
    res.status(500).json({ error: "internal server error" });
  }
}

module.exports = {
  processAndSaveImage,
  getAllImages,
  getAllImagesByPage,
  getCertainMonthImagesByPage,
};
