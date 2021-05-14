/*
용도: 수동으로 썸네일 용량 줄인파일 만듦. 만드는건 경로단위라서 설정된 경로에 있는 모든 안 만들어진 파일 다 만듦
사용방법: 코드에서 type, cno 설정후 실행하면 해당 경로에 해당하는 안 만들어진 파일 알아서 만듦
*/

const dotenv = require("dotenv");
const AWS = require("aws-sdk");
const fp = require("lodash/fp");
const sharp = require("sharp");

const type = "prod"; // local | dev | prod
const cno = 9;

dotenv.config({ path: `${__dirname}/.env` });
const s3 = new AWS.S3({ apiVersion: "2006-03-01" });

// listObjectsV2함수의 async ver
async function listObjectAsync(bucketParams) {
  return new Promise((resolve, reject) => {
    s3.listObjectsV2(bucketParams, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

// dir의 모든 경로(key)가지고 오기
async function getObjectKeys(bucketParams) {
  const keys = [];
  let data;
  do {
    data = await listObjectAsync(bucketParams);
    keys.push(data.Contents.map((content) => content.Key));
    bucketParams.ContinuationToken = data.NextContinuationToken;
  } while (data.IsTruncated); // 1000개 이상에 대한 처리
  return keys.flat();
}

async function resizeAllIfImage(keys) {
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    try {
      await resizeIfImage(key);
      console.log(`[${i + 1}/${keys.length}] conversion complete!: ${key}`);
    } catch (error) {
      console.log(error);
    }
  }
}

function isImageFile(contentType) {
  return contentType.split("/")[0] === "image";
}

// 이미지 파일인 경우 변환
async function resizeIfImage(key) {
  // s3로 부터 파일 가져옴
  const params = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
  };
  const file = await s3.getObject(params).promise();

  // image파일이 아닌경우
  if (!isImageFile(file.ContentType))
    throw new Error(`"error: ${key}" is not image file.`);

  // 이미지인 경우 변환
  const buffer = await resize({ file, width: 320, height: 180 });

  // 변환된 이미지 업로드
  const dstKey = makeDstKey(key);
  const destparams = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: dstKey,
    Body: buffer,
    ContentType: file.ContentType,
    ACL: "public-read",
  };
  await s3.putObject(destparams).promise();
}

function makeDstKey(key) {
  const keys = key.split("/");
  return [...keys.slice(0, 3), "thumbs", ...keys.slice(3, keys.length)].join(
    "/"
  );
}

// 알아서 요래조래 사이즈 변경함
async function resize({ file, width, height }) {
  const metaData = await sharp(file.Body).metadata();
  if (metaData.width < width && metaData.height < height) {
    return file.Body;
  } else if (metaData.width * 9 > metaData.height * 16) {
    return await sharp(file.Body).resize({ width }).toBuffer();
  } else {
    return await sharp(file.Body).resize({ height }).toBuffer();
  }
}

(async function () {
  try {
    const S3_DIR_PATH = `${type}/${cno}/images/`;
    const bucketParams = {
      Bucket: process.env.S3_BUCKET_NAME,
      Prefix: S3_DIR_PATH,
    };
    // bucket의 모든 친구들
    const keys = await getObjectKeys(bucketParams);

    // 이미 변환된 친구들
    const convertedKeys = fp.flow(
      fp.filter(fp.includes("thumbs/")),
      fp.map(fp.split("/")),
      fp.map(fp.last),
      fp.map((path) => [path, true]),
      fp.fromPairs
    )(keys);

    // bucket의 변환안된 친구들
    const unconvertedKeys = fp.flow(
      fp.map(fp.split("/")),
      fp.map((arr) => ({ path: fp.join("/", arr), fileName: fp.last(arr) })),
      fp.filter((obj) => !convertedKeys[obj.fileName]),
      fp.map(fp.get("path"))
    )(keys);

    // 변환
    // await resizeAllIfImage([unconvertedKeys[0]]);
    await resizeAllIfImage(unconvertedKeys);
  } catch (error) {
    console.log(error);
  }
})();
