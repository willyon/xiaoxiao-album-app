/*
 * @Author: zhangshouchang
 * @Date: 2024-08-30 15:07:02
 * @LastEditors: zhangshouchang
 * @LastEditTime: 2024-09-19 00:12:32
 * @Description: File description
 */
const { DateTime } = require("luxon");

function stringToTimestamp(str) {
  const date = DateTime.fromFormat(str, "yyyy:MM:dd HH:mm:ss", { zone: "utc" });
  // 检查是否解析成功
  if (!date.isValid) {
    console.error("时间格式化出错:", date.invalidReason);
  } else {
    // 获取时间戳（毫秒）
    return date.toMillis();
  }
}

function getStartOrEndOfMonth(timestamp, type) {
  // 转为Datetime对象
  const date = DateTime.fromMillis(+timestamp);
  const typeOfMonth = date[`${type}Of`]("month");
  return typeOfMonth.toMillis();
}

module.exports = {
  stringToTimestamp,
  getStartOrEndOfMonth,
};
