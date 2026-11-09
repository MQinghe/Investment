import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

export async function chooseBackup(): Promise<{ name: string; text: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (result.canceled) return null;
  const file = result.assets[0];
  if (!/\.(json|csv|tsv)$/i.test(file.name)) throw Error('请选择 JSON、CSV 或 TSV 文件。');
  if (file.size && file.size > 5 * 1024 * 1024) throw Error('文件超过 5 MB，请分批导入。');
  const text = Platform.OS === 'web' && file.file
    ? await file.file.text()
    : await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.UTF8 });
  if (text.length > 5 * 1024 * 1024) throw Error('文件超过 5 MB，请分批导入。');
  if (text.includes('\uFFFD')) throw Error('文件不是 UTF-8 编码。请用表格软件另存为 CSV UTF-8，或使用网页版 JSON 备份。');
  return { name: file.name, text: text.replace(/^\uFEFF/, '') };
}

export async function exportFile(filename: string, content: string, mimeType: string, share = false): Promise<boolean> {
  if (Platform.OS === 'web') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000); return true;
  }
  if (Platform.OS === 'android' && !share) {
    const access = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!access.granted) return false;
    const uri = await FileSystem.StorageAccessFramework.createFileAsync(access.directoryUri, filename, mimeType);
    await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
    return true;
  }
  if (!await Sharing.isAvailableAsync()) throw Error('当前设备暂不支持分享文件，请使用保存到手机。');
  if (!FileSystem.cacheDirectory) throw Error('暂时无法访问手机缓存目录。');
  const uri = FileSystem.cacheDirectory + filename;
  await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: '导出持仓手记备份' });
  return true;
}
