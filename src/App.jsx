import React, { useState, useMemo, useEffect, useRef } from 'react';
import { ChevronRight, ChevronDown, Search, X, Layers, Maximize2, Minimize2, Upload, FileText, AlertCircle, CheckCircle2, Save, RefreshCw, Loader2 } from 'lucide-react';
import { getFiles, getFile, saveFile } from './services/firebase';

// --- 解析邏輯 ---

/**
 * 解析 RosettaNet HTM 檔案內容
 * @param {string} htmlContent - 檔案的 HTML 文字內容
 * @returns {Array} 格式化後的 rawData 陣列
 */
const parseRosettaNetHtml = (htmlContent) => {
  // 0. 預處理：清除 Unicode 替換字元 ( / U+FFFD)
  const cleanContent = htmlContent.replace(/\uFFFD/g, '');

  const parser = new DOMParser();
  const doc = parser.parseFromString(cleanContent, 'text/html');

  // 1. 建立定義字典 (Name -> Definition)
  const definitions = {};
  const tables = Array.from(doc.querySelectorAll('table'));

  tables.forEach(table => {
    const rows = Array.from(table.querySelectorAll('tr'));
    // 檢查表頭或內容是否包含定義關鍵字
    const isDefTable = rows.some(tr => {
      const text = tr.textContent.toLowerCase();
      return text.includes('name') && text.includes('definition');
    });

    if (isDefTable) {
      rows.forEach(tr => {
        const tds = tr.querySelectorAll('td');
        if (tds.length >= 2) {
          const name = tds[0].textContent.trim();
          let def = tds[1].textContent.trim();

          // 強健的 Unformatted text 取代邏輯 (忽略大小寫、忽略句點)
          if (/^unformatted\s*text\.?$/i.test(def)) {
            def = "";
          }

          if (name && name.toLowerCase() !== 'name') {
            definitions[name] = def;
          }
        }
      });
    }
  });

  // 2. 解析主結構樹
  // 策略：尋找包含階層特徵符號 "|--" 且行數最多的表格
  let mainTable = null;
  let maxTreeScore = 0;

  tables.forEach(table => {
    const rows = table.querySelectorAll('tr');
    if (rows.length > 5) {
      let score = 0;
      rows.forEach(tr => {
        if (tr.textContent.includes('|--')) score++;
      });
      if (score > maxTreeScore) {
        maxTreeScore = score;
        mainTable = table;
      }
    }
  });

  // 如果找不到明顯的樹狀表，嘗試找欄位數正確的大表
  if (!mainTable) {
    console.warn("找不到含有 |-- 的表格，嘗試尋找最大的資料表...");
    mainTable = tables.sort((a, b) => b.querySelectorAll('tr').length - a.querySelectorAll('tr').length)[0];
  }

  if (!mainTable) {
    throw new Error("無法識別任何有效的表格結構，請確認檔案內容。");
  }

  const rawData = [];
  const rows = Array.from(mainTable.querySelectorAll('tr'));

  // 追蹤每一層最後出現的 ID，用於建立父子關係
  // parentIds[level] = id
  const parentIds = { "-1": 0 };

  rows.forEach((tr) => {
    const tds = tr.querySelectorAll('td');
    // 確保這一行至少有 3 欄 (ID, Cardinality/Count, Name)
    if (tds.length < 3) return;

    // 嘗試解析欄位 1: ID
    const fieldNoStr = tds[0].textContent.trim();
    // 有些檔案 ID 是放在 <a> 標籤內，濾掉非數字字元
    const cleanIdStr = fieldNoStr.replace(/[^\d]/g, '');
    const id = parseInt(cleanIdStr, 10);

    if (isNaN(id)) return; // 如果第一欄不是數字，跳過 (可能是表頭)

    // 嘗試取得名稱欄位：通常在第 3 欄 (Index 2)
    let nameTd = tds[2];
    let rawNameText = nameTd.textContent;

    // 處理 HTML Entity (如 &nbsp;)
    rawNameText = rawNameText.replace(/\u00a0/g, " ");

    // 計算層級：計算 "|" 的數量
    const pipeCount = (rawNameText.match(/\|/g) || []).length;
    let level = pipeCount;

    // 清理名稱：移除 "|", "--", 點點等符號
    let cleanName = rawNameText.replace(/[|\-]/g, '').trim();

    // 假如 cleanName 是空的 (或是只有點)，可能抓錯欄位或格式特殊
    if (!cleanName && tds.length > 3) {
      // 嘗試下一欄
      rawNameText = tds[3].textContent;
      cleanName = rawNameText.replace(/[|\-]/g, '').trim();
    }

    // 處理 parentId
    const parentId = parentIds[level - 1] !== undefined ? parentIds[level - 1] : 0;

    // 更新當前層級的 ID
    parentIds[level] = id;

    // 查詢 Description
    let description = "";
    const parts = cleanName.split('.');

    // 優先順序：完整名稱 -> 屬性名(parts[0]) -> 類型名(parts[1])
    if (definitions[cleanName]) {
      description = definitions[cleanName];
    } else if (parts.length > 0 && definitions[parts[0]]) {
      description = definitions[parts[0]];
    } else if (parts.length > 1 && definitions[parts[1]]) {
      description = definitions[parts[1]];
    }

    // [id, parentId, fieldNo, level, name, description]
    rawData.push([id, parentId, fieldNoStr, level, cleanName, description]);
  });

  return rawData;
};


// --- 上傳元件 ---

const FileUpload = ({ onDataLoaded }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const processFile = (file) => {
    setError(null);
    if (!file) return;

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.htm') && !fileName.endsWith('.html') && !fileName.endsWith('.txt')) {
      setError("請上傳 .htm 或 .html 檔案");
      return;
    }

    setIsLoading(true);
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const content = e.target.result;
        const parsedData = parseRosettaNetHtml(content);

        if (parsedData.length === 0) {
          throw new Error("解析成功但沒有找到資料列 (Rows = 0)。");
        }

        onDataLoaded(parsedData, file.name, content);
      } catch (err) {
        console.error(err);
        setError("無法建立資料表: " + err.message);
      } finally {
        setIsLoading(false);
      }
    };

    reader.onerror = () => {
      setError("讀取檔案失敗");
      setIsLoading(false);
    };

    reader.readAsText(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      processFile(files[0]);
    }
  };

  const handleFileSelect = (e) => {
    const files = e.target.files;
    if (files.length > 0) {
      processFile(files[0]);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6">
      <div
        className={`
          w-full max-w-2xl p-12 rounded-xl border-2 border-dashed transition-all duration-200 flex flex-col items-center justify-center cursor-pointer
          ${isDragging ? 'border-blue-500 bg-blue-50 scale-105' : 'border-slate-300 bg-white hover:border-blue-400 hover:bg-slate-50'}
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => document.getElementById('fileInput').click()}
      >
        <input
          type="file"
          id="fileInput"
          className="hidden"
          accept=".htm,.html,.txt"
          onChange={handleFileSelect}
        />

        {isLoading ? (
          <div className="animate-pulse flex flex-col items-center">
            <div className="h-12 w-12 bg-blue-200 rounded-full mb-4"></div>
            <div className="h-4 w-48 bg-slate-200 rounded mb-2"></div>
            <div className="text-slate-500">正在處理檔案...</div>
          </div>
        ) : (
          <>
            <div className="bg-blue-100 p-4 rounded-full mb-4">
              <Upload className="w-8 h-8 text-blue-600" />
            </div>
            <h3 className="text-xl font-bold text-slate-700 mb-2">上傳 RosettaNet 規範</h3>
            <p className="text-slate-500 text-center mb-6">
              拖放檔案或點擊上傳<br />
              <span className="text-xs text-slate-400 mt-2 block">(支援 .htm / .html)</span>
            </p>
            <button className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm font-medium">
              選擇檔案
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="mt-6 flex items-start p-4 bg-red-50 text-red-700 rounded-lg border border-red-200 max-w-2xl w-full animate-fade-in">
          <AlertCircle className="w-5 h-5 mr-3 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">錯誤</p>
            <p className="text-sm">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
};

// --- 主程式 ---

function App() {
  const [data, setData] = useState([]);
  const [fileName, setFileName] = useState("");
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [highlightedIds, setHighlightedIds] = useState(new Set());
  const [searchMode, setSearchMode] = useState('keyword');

  // GAS Storage State
  const [fileList, setFileList] = useState([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [rawFileContent, setRawFileContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isFileLoading, setIsFileLoading] = useState(false);

  // Load file list from GAS
  useEffect(() => {
    fetchFileList();
  }, []);

  const fetchFileList = async () => {
    setIsLoadingList(true);
    try {
      const files = await getFiles();
      setFileList(files);
    } catch (err) {
      console.error("Failed to load file list", err);
    } finally {
      setIsLoadingList(false);
    }
  };

  const handleGasFileSelect = async (e) => {
    const filename = e.target.value;
    if (!filename) return;

    setSelectedFile(filename);
    setIsFileLoading(true);
    try {
      // Small delay to ensure UI updates (optional, but feels better)
      await new Promise(resolve => setTimeout(resolve, 100));

      const content = await getFile(filename);
      if (content) {
        // Parse the content
        const parsedData = parseRosettaNetHtml(content);
        handleDataLoaded(parsedData, filename, content);
      }
    } catch (err) {
      alert("載入檔案失敗: " + err.message);
    } finally {
      setIsFileLoading(false);
    }
  };

  const handleSaveToGas = async () => {
    if (!rawFileContent) {
      alert("目前沒有可儲存的內容");
      return;
    }

    const name = prompt("請輸入檔案名稱 (例如: template.html):", fileName || "template.html");
    if (!name) return;

    setIsSaving(true);
    try {
      const success = await saveFile(name, rawFileContent);
      if (success) {
        alert("儲存成功！");
        fetchFileList(); // Refresh list
      }
    } catch (err) {
      alert("儲存失敗: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDataLoaded = (parsedData, name, rawContent) => {
    const formattedData = parsedData.map(item => ({
      id: item[0],
      parentId: item[1],
      fieldNo: item[2],
      level: item[3],
      name: item[4],
      description: item[5]
    }));

    setData(formattedData);
    setFileName(name);
    setRawFileContent(rawContent || ""); // Save raw content
    // 預設全收合 (不展開任何節點)
    setExpandedIds(new Set());
  };

  const toggleNode = (id) => {
    const newExpanded = new Set(expandedIds);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedIds(newExpanded);
  };

  const expandAll = () => {
    const allParentIds = new Set(data.filter(item =>
      data.some(child => child.parentId === item.id)
    ).map(item => item.id));
    setExpandedIds(allParentIds);
  };

  const collapseAll = () => {
    setExpandedIds(new Set());
  };

  const clearView = () => {
    setSearchTerm('');
    setHighlightedIds(new Set());
    setSearchMode('keyword');
    collapseAll();
  };

  const resetFile = () => {
    setData([]);
    setFileName("");
    clearView();
  };

  // 搜尋與路徑處理邏輯
  useEffect(() => {
    if (data.length === 0) return;

    if (!searchTerm.trim()) {
      setHighlightedIds(new Set());
      setSearchMode('keyword');
      return;
    }

    let trimmedTerm = searchTerm.trim();

    // 檢查是否為路徑搜尋 (包含 / 或是 Pip 開頭)
    if (trimmedTerm.includes('/') || trimmedTerm.startsWith('Pip')) {
      setSearchMode('path');

      let path = trimmedTerm;

      // 1. 移除前綴與雜訊
      path = path.replace(/^\/?Pip[^\/]+\//, ''); // 移除 /PipXXXX/
      path = path.replace(/\[\d*\]/g, ""); // 移除 [0]

      // 2. 清理前後斜線
      if (path.startsWith('/')) path = path.substring(1);
      if (path.endsWith('/')) path = path.substring(0, path.length - 1);

      const segments = path.split('/').filter(Boolean);

      const newExpanded = new Set();
      let currentParentId = 0; // 假設根節點 parentId 為 0
      let matchedNodeId = null;
      let i = 0;

      // 開始路徑遍歷
      while (i < segments.length) {
        const segment = segments[i];
        const nextSegment = segments[i + 1];

        // 找出目前層級的所有子節點
        const children = data.filter(d => d.parentId === currentParentId);

        let foundMatch = false;

        // 策略 1: 複合名稱匹配 (e.g., telephoneNumber + . + CommunicationsNumber)
        if (nextSegment) {
          const compoundName = `${segment}.${nextSegment}`;
          const match = children.find(c => c.name.toLowerCase() === compoundName.toLowerCase() || c.name.includes(compoundName));
          if (match) {
            newExpanded.add(match.id);
            currentParentId = match.id;
            matchedNodeId = match.id;
            i += 2; // 跳過兩個 segment
            foundMatch = true;
            continue;
          }
        }

        // 策略 2: 單一名稱匹配
        if (!foundMatch) {
          // 寬鬆匹配: 節點名稱包含 segment 即可
          const match = children.find(c => c.name.toLowerCase() === segment.toLowerCase() || c.name.includes(segment));
          if (match) {
            newExpanded.add(match.id);
            currentParentId = match.id;
            matchedNodeId = match.id;
            i += 1;
            foundMatch = true;
            continue;
          }
        }

        // 策略 3: 自動嘗試插入 Choice 層級 (遞迴修正)
        // 如果當前 segment 找不到，但它是 WorkInProcess 等特殊路徑的一部分
        // 我們檢查子節點中是否有 "Choice" 節點，如果有，嘗試進入 Choice 再找一次 segment
        if (!foundMatch) {
          const choiceNode = children.find(c => c.name === 'Choice' || c.name === '(Choice)');
          if (choiceNode) {
            // 暫時展開 Choice 節點
            const choiceChildren = data.filter(d => d.parentId === choiceNode.id);
            // 在 Choice 的子節點中尋找當前的 segment
            const matchInChoice = choiceChildren.find(c => c.name.toLowerCase() === segment.toLowerCase() || c.name.includes(segment));

            if (matchInChoice) {
              console.log(`Auto-resolved Choice path at segment: ${segment}`);
              newExpanded.add(choiceNode.id); // 展開 Choice
              newExpanded.add(matchInChoice.id); // 展開目標

              currentParentId = matchInChoice.id;
              matchedNodeId = matchInChoice.id;
              i += 1;
              foundMatch = true;
              continue;
            }
          }
        }

        // 如果這層真的找不到，就停止
        if (!foundMatch) {
          console.log(`Search stopped at segment: ${segment}, ParentID: ${currentParentId}`);
          break;
        }
      }

      if (matchedNodeId) {
        setExpandedIds(newExpanded);
        setHighlightedIds(new Set([matchedNodeId]));
      } else {
        setHighlightedIds(new Set());
      }

    } else {
      // 關鍵字搜尋模式
      setSearchMode('keyword');
      const lowerTerm = trimmedTerm.toLowerCase();

      const matches = data.filter(item =>
        item.name.toLowerCase().includes(lowerTerm) ||
        item.fieldNo.includes(lowerTerm)
      );

      const newHighlighted = new Set(matches.map(m => m.id));
      const newExpanded = new Set(expandedIds);

      matches.forEach(match => {
        let currentParentId = match.parentId;
        while (currentParentId !== 0) {
          newExpanded.add(currentParentId);
          const parent = data.find(d => d.id === currentParentId);
          if (parent) {
            currentParentId = parent.parentId;
          } else {
            break;
          }
        }
      });

      setHighlightedIds(newHighlighted);
      setExpandedIds(newExpanded);
    }
  }, [searchTerm, data]);

  const visibleItems = useMemo(() => {
    if (data.length === 0) return [];
    const idMap = new Map(data.map(d => [d.id, d]));

    return data.filter(item => {
      if (item.parentId === 0) return true;
      let currentParentId = item.parentId;
      while (currentParentId !== 0) {
        if (!expandedIds.has(currentParentId)) return false;
        const parent = idMap.get(currentParentId);
        if (!parent) return false;
        currentParentId = parent.parentId;
      }
      return true;
    });
  }, [data, expandedIds]);

  const tableRef = useRef(null);

  // 自動捲動到結果
  useEffect(() => {
    if (searchMode === 'path' && highlightedIds.size === 1) {
      const id = Array.from(highlightedIds)[0];
      setTimeout(() => {
        const element = document.getElementById(`row-${id}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
  }, [highlightedIds, searchMode]);

  if (data.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 font-sans text-gray-800 relative">

        {/* Global Loading Overlay */}
        {isFileLoading && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm">
            <div className="flex flex-col items-center animate-fade-in">
              <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
              <h3 className="text-xl font-bold text-slate-700">Now Loading...</h3>
              <p className="text-slate-500">正在讀取雲端檔案</p>
            </div>
          </div>
        )}

        <div className="max-w-7xl mx-auto pt-10">
          <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
            <div className="bg-slate-800 p-6 text-white text-center">
              <h1 className="text-2xl font-bold tracking-tight">RosettaNet XML Viewer</h1>
              <p className="text-slate-400 text-sm mt-1">Universal Viewer</p>
            </div>
            <FileUpload onDataLoaded={handleDataLoaded} />

            {/* Initial GAS Loader */}
            <div className="border-t border-gray-100 bg-slate-50/50 p-6">
              <div className="max-w-xl mx-auto">
                <GasFileSelector
                  fileList={fileList}
                  selectedFile={selectedFile}
                  onSelect={handleGasFileSelect}
                  onRefresh={fetchFileList}
                  isLoading={isLoadingList}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 font-sans text-gray-800">

      {/* Global Loading Overlay */}
      {isFileLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm">
          <div className="flex flex-col items-center animate-fade-in">
            <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
            <h3 className="text-xl font-bold text-slate-700">Now Loading...</h3>
            <p className="text-slate-500">正在讀取雲端檔案</p>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto bg-white rounded-xl shadow-lg overflow-hidden border border-gray-100 flex flex-col h-[calc(100vh-48px)]">

        {/* Header */}
        <div className="bg-slate-800 p-6 text-white shrink-0">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                <span className="bg-slate-700 text-xs px-2 py-1 rounded text-slate-300 flex items-center gap-2" title={fileName}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" className="w-5 h-5">
                    <rect x="0" y="0" width="64" height="64" rx="12" fill="#005b96" />
                    <text x="50%" y="53%" fontFamily="monospace" fontWeight="bold" fontSize="36" fill="white" textAnchor="middle" dominantBaseline="central">{'</>'}</text>
                  </svg>
                  {fileName}
                </span>
              </h1>

              {/* Cloud Controls - Inline with title */}
              <div className="flex items-center gap-2">
                <select
                  className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 outline-none text-slate-200 max-w-[200px]"
                  onChange={handleGasFileSelect}
                  value={selectedFile}
                >
                  <option value="">-- Load from Cloud --</option>
                  {fileList.map(f => (
                    <option key={f.name} value={f.name}>{f.name}</option>
                  ))}
                </select>
                <button onClick={fetchFileList} className="p-1.5 bg-slate-600 hover:bg-slate-500 rounded text-slate-300 transition-colors" title="Reload List">
                  <RefreshCw className={`w-4 h-4 ${isLoadingList ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={handleSaveToGas}
                  disabled={isSaving || !rawFileContent}
                  className={`p-1.5 rounded transition-colors
                    ${isSaving || !rawFileContent
                      ? 'bg-slate-600 text-slate-400 cursor-not-allowed'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    }
                  `}
                  title={isSaving ? "Saving..." : "Save to Cloud"}
                >
                  <Save className="w-4 h-4" />
                </button>
              </div>
            </div>

            <p className="text-slate-400 text-sm">
              {visibleItems.length} items visible / {data.length} total
            </p>
          </div>

          {/* Search Box */}
          <div className="mb-4">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 h-4 w-4" />
              <input
                type="text"
                placeholder="搜尋關鍵字或路徑 (支援自動補全 Choice)"
                className="w-full pl-10 pr-4 py-2 rounded-lg bg-slate-700 border-none text-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 items-center justify-between">
            <div className="flex gap-2">
              <ControlBtn onClick={expandAll} icon={<Maximize2 className="w-4 h-4" />}>全部展開</ControlBtn>
              <ControlBtn onClick={collapseAll} icon={<Minimize2 className="w-4 h-4" />}>全部收合</ControlBtn>
              <ControlBtn onClick={clearView} icon={<Layers className="w-4 h-4" />} variant="secondary">重置檢視</ControlBtn>

              {searchMode === 'path' && highlightedIds.size > 0 && (
                <span className="ml-2 text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded border border-green-500/30 flex items-center gap-1 animate-pulse">
                  <CheckCircle2 className="w-3 h-3" /> 路徑定位成功
                </span>
              )}
            </div>

            <button
              onClick={resetFile}
              className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors"
            >
              <Upload className="w-3 h-3" /> 上傳新檔案
            </button>
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-auto flex-1 relative scroll-smooth" ref={tableRef}>
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold tracking-wider sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-6 py-3 border-b border-gray-200 w-24 text-center">Field #</th>
                <th className="px-6 py-3 border-b border-gray-200 w-24 text-center">Level</th>
                <th className="px-6 py-3 border-b border-gray-200">Description / Tag Name</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleItems.map((item) => {
                const hasChildren = data.some(child => child.parentId === item.id);
                const isExpanded = expandedIds.has(item.id);
                const isHighlighted = highlightedIds.has(item.id);

                return (
                  <tr
                    key={item.id}
                    id={`row-${item.id}`}
                    className={`
                      group transition-colors duration-150 ease-in-out
                      ${isHighlighted ? 'bg-amber-100 hover:bg-amber-200' : 'hover:bg-blue-50/50'}
                      ${isHighlighted ? 'border-l-4 border-amber-500' : 'border-l-4 border-transparent'}
                    `}
                  >
                    <td className="px-6 py-2 text-center text-gray-400 text-sm font-mono">{item.fieldNo}</td>
                    <td className="px-6 py-2 text-center text-gray-400 text-sm font-mono">
                      <span className={`px-2 py-0.5 rounded text-xs ${item.level === 0 ? 'bg-blue-100 text-blue-600' : 'bg-gray-100'}`}>
                        {item.level}
                      </span>
                    </td>
                    <td className="px-6 py-2 relative">
                      <div
                        className="flex items-center"
                        style={{ paddingLeft: `${item.level * 24}px` }}
                      >
                        <div className="w-6 h-6 flex items-center justify-center mr-2 shrink-0">
                          {hasChildren && (
                            <button
                              onClick={() => toggleNode(item.id)}
                              className="text-slate-400 hover:text-blue-600 focus:outline-none transition-transform"
                            >
                              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                          )}
                        </div>

                        <div className="flex-1 group/tooltip relative">
                          <span
                            className={`
                                cursor-help font-medium transition-all block truncate
                                ${isHighlighted ? 'text-amber-800 font-bold text-base' : item.level === 0 ? 'text-slate-800' : 'text-slate-600'}
                              `}
                          >
                            {item.name}
                          </span>

                          {item.description && (
                            <div className="absolute left-0 bottom-full mb-2 hidden group-hover/tooltip:block z-50 w-max max-w-md pointer-events-none">
                              <div className="bg-slate-800 text-white text-xs rounded py-2 px-3 shadow-xl leading-relaxed whitespace-normal break-words">
                                {item.description}
                                <div className="absolute left-4 top-full w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-slate-800"></div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {visibleItems.length === 0 && (
                <tr>
                  <td colSpan="3" className="px-6 py-12 text-center text-gray-400">
                    <div className="flex flex-col items-center">
                      <Search className="w-8 h-8 mb-2 opacity-20" />
                      <p>沒有找到符合的項目</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// --- 輔助元件 ---

const GasFileSelector = ({ fileList, selectedFile, onSelect, onRefresh, isLoading }) => (
  <div className="flex flex-col gap-1 w-full">
    <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Load from Cloud</label>
    <div className="flex gap-2">
      <select
        className="flex-1 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none text-slate-200"
        onChange={onSelect}
        value={selectedFile}
      >
        <option value="">-- Select a file from Sheet --</option>
        {fileList.map(f => (
          <option key={f.name} value={f.name}>{f.name} ({new Date(f.updated).toLocaleDateString()})</option>
        ))}
      </select>
      <button onClick={onRefresh} className="p-2 bg-slate-600 hover:bg-slate-500 rounded text-slate-300 transition-colors" title="Reload List">
        <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
      </button>
    </div>
  </div>
);

const ControlBtn = ({ onClick, children, icon, variant = 'primary' }) => {
  const baseClass = "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800";
  const variants = {
    primary: "bg-slate-700 text-slate-200 hover:bg-slate-600 focus:ring-slate-500",
    secondary: "bg-slate-600 text-slate-300 hover:bg-slate-500 focus:ring-slate-400",
    danger: "bg-red-500/10 text-red-400 hover:bg-red-500/20 focus:ring-red-500 hover:text-red-300",
  };

  return (
    <button onClick={onClick} className={`${baseClass} ${variants[variant]}`}>
      {icon}
      {children}
    </button>
  );
};

export default App;