import * as fs from 'fs';
import * as path from 'path';

export interface SizeReport {
  mainPackageSize: number;
  totalSize: number;
  status: 'ok' | 'warning' | 'blocked';
  message: string;
  topFiles?: Array<{ file: string; size: number }>;
}

/**
 * Check the dist-wx/ output size against WeChat limits.
 *
 * Rules (from PRD §7.7.4):
 * - Main package ≤ 4MB: OK (typically ~50KB with engine subpackaged)
 * - Total ≤ 16MB: OK
 * - Total 16-20MB: Warning
 * - Total > 20MB: Blocked
 */
export function checkDistSize(projectPath: string): SizeReport {
  const distWxDir = path.join(projectPath, 'dist-wx');
  if (!fs.existsSync(distWxDir)) {
    return {
      mainPackageSize: 0,
      totalSize: 0,
      status: 'blocked',
      message: 'dist-wx/ not found',
    };
  }

  // Calculate total size and collect file sizes
  const fileSizes: Array<{ file: string; size: number }> = [];
  let totalSize = 0;
  let mainPackageSize = 0;

  function walkDir(dir: string, prefix: string = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        walkDir(fullPath, relativePath);
      } else if (entry.isFile()) {
        const size = fs.statSync(fullPath).size;
        fileSizes.push({ file: relativePath, size });
        totalSize += size;

        // Main package = root-level files (not in subpackage dirs)
        if (!prefix.includes('/')) {
          mainPackageSize += size;
        }
      }
    }
  }

  walkDir(distWxDir);

  // Sort files by size descending for top-5 report
  fileSizes.sort((a, b) => b.size - a.size);
  const topFiles = fileSizes.slice(0, 5);

  const MB = 1024 * 1024;
  const totalMB = (totalSize / MB).toFixed(1);
  const mainMB = (mainPackageSize / MB).toFixed(1);

  if (totalSize > 20 * MB) {
    return {
      mainPackageSize,
      totalSize,
      status: 'blocked',
      message: `Total size ${totalMB}MB exceeds 20MB limit. Remove or optimize the largest files.`,
      topFiles,
    };
  }

  if (totalSize > 16 * MB) {
    return {
      mainPackageSize,
      totalSize,
      status: 'warning',
      message: `Total size ${totalMB}MB is between 16-20MB. Consider moving large assets to public/remote-assets/ for CDN loading.`,
      topFiles,
    };
  }

  return {
    mainPackageSize,
    totalSize,
    status: 'ok',
    message: `Main package: ${mainMB}MB, Total: ${totalMB}MB. Within WeChat limits.`,
  };
}
