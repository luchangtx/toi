/**
 * 轻量 CSV 生成与导出（替代原版 xlsx.full.min.js，避免 881KB 依赖撑爆主包）
 */

var BOM = '\uFEFF'; // UTF-8 BOM，否则 Excel 打开中文乱码

/** 单元格转义：含逗号 / 双引号 / 换行时用双引号包裹，内部双引号翻倍 */
function escapeCell(value) {
  var s = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** 二维数组 → CSV 文本（带 BOM，CRLF 行尾兼容 Excel） */
function toCsv(rows) {
  var body = rows.map(function (row) {
    return row.map(escapeCell).join(',');
  }).join('\r\n');
  return BOM + body;
}

/**
 * 写文件 → 转发给微信好友；失败依次降级到「打开预览」「复制到剪贴板」
 * @param {Object} options { fileName, rows }
 * @returns {Promise<{ way: string }>}
 */
function exportCsv(options) {
  var fileName = options.fileName;
  var content = toCsv(options.rows);
  var filePath = wx.env.USER_DATA_PATH + '/' + fileName;

  return new Promise(function (resolve, reject) {
    var fs = wx.getFileSystemManager();
    try {
      fs.writeFileSync(filePath, content, 'utf8');
    } catch (e) {
      reject(e);
      return;
    }

    wx.shareFileMessage({
      filePath: filePath,
      fileName: fileName,
      success: function () { resolve({ way: 'share', filePath: filePath }); },
      fail: function () {
        // 部分基础库/机型不支持 .csv 转发，降级为文档预览
        wx.openDocument({
          filePath: filePath,
          showMenu: true,
          success: function () { resolve({ way: 'open', filePath: filePath }); },
          fail: function () {
            // 最终兜底：复制纯文本，用户可自行粘贴保存
            wx.setClipboardData({
              data: content.replace(BOM, ''),
              success: function () { resolve({ way: 'clipboard', filePath: filePath }); },
              fail: function (err) { reject(err); }
            });
          }
        });
      }
    });
  });
}

module.exports = {
  BOM: BOM,
  escapeCell: escapeCell,
  toCsv: toCsv,
  exportCsv: exportCsv
};
