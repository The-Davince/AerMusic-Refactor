
const DEFAULT_LRC_LINE_DURATION = 2500;

class TtmlTools {








    lrcToTtmlWithAll(args) {
        const originalLrc = String(args.ORIGINAL_LRC || "");
        const translatedLrc = String(args.TRANSLATED_LRC || "");
        const romajiLrc = String(args.ROMAJI_LRC || "");
        return this._lrcToTtmlCore(originalLrc, translatedLrc, romajiLrc);
    }

    _lrcToTtmlCore(originalLrc, translatedLrc, romajiLrc) {
        const originalLines = this._parseLrc(originalLrc).filter(line => !line.isMeta);
        const translatedLines = this._parseLrc(translatedLrc).filter(line => !line.isMeta);
        const romajiLines = this._parseLrc(romajiLrc).filter(line => !line.isMeta);
        
        
        if (originalLines.length === 0 && translatedLines.length === 0 && romajiLines.length === 0) {
            return '<?xml version="1.0" encoding="UTF-8"?><tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" itunes:timing="Line"></tt>';
        }
        
        
        const lastOriginal = originalLines[originalLines.length - 1];
        const lastTranslation = translatedLines[translatedLines.length - 1];
        const lastRomaji = romajiLines[romajiLines.length - 1];
        
        let maxTime = 0;
        if (lastOriginal && lastOriginal.time > maxTime) maxTime = lastOriginal.time;
        if (lastTranslation && lastTranslation.time > maxTime) maxTime = lastTranslation.time;
        if (lastRomaji && lastRomaji.time > maxTime) maxTime = lastRomaji.time;
        
        const totalDuration = maxTime + 5000;
        
        
        let ttml = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" itunes:timing="Line" itunes:origin="lrc" xml:space="preserve">
    <head>
        <metadata>
            <ttm:agent type="person" xml:id="v1"/>
        </metadata>
    </head>
    <body dur="${this._formatTime(totalDuration)}">
        <div xmlns="" begin="00:00.000" end="${this._formatTime(totalDuration)}">`;
        
        
        if (originalLines.length > 0) {
            
            const usedRomaji = new Set();
            const usedTranslations = new Set();
            
            for (let i = 0; i < originalLines.length; i++) {
                const line = originalLines[i];
                const nextLine = originalLines[i + 1];
                const endTime = nextLine ? nextLine.time : line.time + 5000;
                
                
                
                let romaji = null;
                let bestRomaDiff = Infinity;
                let romaIndex = -1;
                
                for (let j = 0; j < romajiLines.length; j++) {
                    if (usedRomaji.has(j)) continue;
                    
                    const diff = Math.abs(romajiLines[j].time - line.time);
                    if (diff < 500 && diff < bestRomaDiff) {
                        bestRomaDiff = diff;
                        romaji = romajiLines[j];
                        romaIndex = j;
                    }
                }
                
                ttml += `<p begin="${this._formatTime(line.time)}" end="${this._formatTime(endTime)}" ttm:agent="v1" itunes:key="L${i + 1}">`;
                
                
                ttml += `<span>${this._escapeXml(line.text)}</span>`;
                
                if (romaji) {
                    ttml += `<span ttm:role="x-roman">${this._escapeXml(romaji.text)}</span>`;
                    usedRomaji.add(romaIndex);
                }

                let translation = null;
                let bestTranslationDiff = Infinity;
                let translationIndex = -1;
                for (let j = 0; j < translatedLines.length; j++) {
                    if (usedTranslations.has(j)) continue;
                    const diff = Math.abs(translatedLines[j].time - line.time);
                    if (diff < 500 && diff < bestTranslationDiff) {
                        bestTranslationDiff = diff;
                        translation = translatedLines[j];
                        translationIndex = j;
                    }
                }
                if (translation) {
                    ttml += `<span ttm:role="x-translation" xml:lang="zh-CN">${this._escapeXml(translation.text)}</span>`;
                    usedTranslations.add(translationIndex);
                }
                
                ttml += `</p>`;
            }
        } else {
            
            const allLines = [
                ...translatedLines.map(l => ({...l, type: 'translation'})),
                ...romajiLines.map(l => ({...l, type: 'romaji'}))
            ];
            
            
            allLines.sort((a, b) => a.time - b.time);
            
            
            for (let i = 0; i < allLines.length; i++) {
                const line = allLines[i];
                const nextLine = allLines[i + 1];
                const endTime = nextLine ? nextLine.time : line.time + 5000;
                
                ttml += `<p begin="${this._formatTime(line.time)}" end="${this._formatTime(endTime)}" ttm:agent="v1" itunes:key="L${i + 1}">`;
                
                if (line.type === 'translation') {
                    ttml += `<span ttm:role="x-translation" xml:lang="zh-CN">${this._escapeXml(line.text)}</span>`;
                } else if (line.type === 'romaji') {
                    ttml += `<span ttm:role="x-roman">${this._escapeXml(line.text)}</span>`;
                }
                
                ttml += `</p>`;
            }
        }
        
        ttml += `
        </div>
    </body>
</tt>`;
        
        return ttml;
    }

    
    krcToYrc(args) {
        const krcText = String(args.KRC_TEXT || "");
        try {
            const lines = krcText.split('\n').filter(line => line.trim() !== '');
            const yrcLines = [];
            
            for (const line of lines) {
                const parsed = this._parseKrcLine(line);
                if (parsed && !this._isMetaText(parsed.words.map(word => word.text).join(''))) {
                    const yrcLine = this._convertKrcLineToYrc(line);
                    if (yrcLine) yrcLines.push(yrcLine);
                }
            }
            
            return yrcLines.join('\n');
        } catch (error) {
            console.error('KRC转YRC错误:', error);
            return '转换失败，请检查KRC格式';
        }
    }

    
    yrcToKrc(args) {
        const yrcText = String(args.YRC_TEXT || "");
        try {
            const lines = yrcText.split('\n').filter(line => line.trim() !== '');
            const krcLines = [];
            
            for (const line of lines) {
                const parsed = this._parseYrcLine(line);
                if (parsed && !this._isMetaText(parsed.words.map(word => word.text).join(''))) {
                    const krcLine = this._convertYrcLineToKrc(line);
                    if (krcLine) krcLines.push(krcLine);
                }
            }
            
            return krcLines.join('\n');
        } catch (error) {
            console.error('YRC转KRC错误:', error);
            return '转换失败，请检查YRC格式';
        }
    }

    
    krcToLrc(args) {
        const krcText = String(args.KRC_TEXT || "");
        try {
            const lines = krcText.split('\n').filter(line => line.trim() !== '');
            const lrcLines = [];
            
            for (const line of lines) {
                const parsed = this._parseKrcLine(line);
                if (parsed && !this._isMetaText(parsed.words.map(word => word.text).join(''))) {
                    const fullText = parsed.words.map(word => word.text).join('');
                    const lrcTime = this._formatLrcTime(parsed.startTime);
                    lrcLines.push(`[${lrcTime}]${fullText}`);
                }
            }
            
            return lrcLines.join('\n');
        } catch (error) {
            console.error('KRC转LRC错误:', error);
            return '转换失败，请检查KRC格式';
        }
    }

    
    yrcToLrc(args) {
        const yrcText = String(args.YRC_TEXT || "");
        try {
            const lines = yrcText.split('\n').filter(line => line.trim() !== '');
            const lrcLines = [];
            
            for (const line of lines) {
                const parsed = this._parseYrcLine(line);
                if (parsed && !this._isMetaText(parsed.words.map(word => word.text).join(''))) {
                    const fullText = parsed.words.map(word => word.text).join('');
                    const lrcTime = this._formatLrcTime(parsed.startTime);
                    lrcLines.push(`[${lrcTime}]${fullText}`);
                }
            }
            
            return lrcLines.join('\n');
        } catch (error) {
            console.error('YRC转LRC错误:', error);
            return '转换失败，请检查YRC格式';
        }
    }

    
    _lrcLineDurations(lines) {
        return lines.map((line, i) => {
            const next = lines[i + 1];
            const gap = next ? next.time - line.time : 0;
            return gap > 0 ? gap : DEFAULT_LRC_LINE_DURATION;
        });
    }

    
    lrcToKrc(args) {
        const lrcText = String(args.LRC_TEXT || "");
        try {
            const lines = this._parseLrc(lrcText).filter(line => !line.isMeta);
            const durations = this._lrcLineDurations(lines);
            return lines.map((line, i) => {
                const head = `[${line.time},${durations[i]}]`;
                return line.text ? `${head}<0,1,0>${line.text}` : head;
            }).join('\n');
        } catch (error) {
            console.error('LRC转KRC错误:', error);
            return '转换失败，请检查LRC格式';
        }
    }

    
    lrcToYrc(args) {
        const lrcText = String(args.LRC_TEXT || "");
        try {
            const lines = this._parseLrc(lrcText).filter(line => !line.isMeta);
            const durations = this._lrcLineDurations(lines);
            return lines.map((line, i) => {
                const head = `[${line.time},${durations[i]}]`;
                return line.text ? `${head}(${line.time},1,0)${line.text}` : head;
            }).join('\n');
        } catch (error) {
            console.error('LRC转YRC错误:', error);
            return '转换失败，请检查LRC格式';
        }
    }

    _qrcLines(qrcText) {
        const content = this._extractQrcContent(String(qrcText || ""));
        const parsed = [];
        content.split('\n').filter(line => line.trim() !== '').forEach(line => {
            const item = this._parseQrcLine(line);
            if (item) parsed.push(item);
        });
        return parsed;
    }

    
    qrcToLrc(args) {
        try {
            return this._qrcLines(args.QRC_TEXT).map(line => {
                const text = line.words.map(word => word.text).join('');
                return `[${this._formatLrcTime(line.startTime)}]${text}`;
            }).join('\n');
        } catch (error) {
            console.error('QRC转LRC错误:', error);
            return '转换失败，请检查QRC格式';
        }
    }

    
    qrcToKrc(args) {
        try {
            return this._qrcLines(args.QRC_TEXT).map(line => {
                const head = `[${line.startTime},${line.duration}]`;
                if (line.words.length === 0) return head;
                return head + line.words.map(word => `<${word.absoluteTime - line.startTime},${word.duration},0>${word.text}`).join('');
            }).join('\n');
        } catch (error) {
            console.error('QRC转KRC错误:', error);
            return '转换失败，请检查QRC格式';
        }
    }

    
    qrcToYrc(args) {
        try {
            return this._qrcLines(args.QRC_TEXT).map(line => {
                const head = `[${line.startTime},${line.duration}]`;
                if (line.words.length === 0) return head;
                return head + line.words.map(word => `(${word.absoluteTime},${word.duration},0)${word.text}`).join('');
            }).join('\n');
        } catch (error) {
            console.error('QRC转YRC错误:', error);
            return '转换失败，请检查QRC格式';
        }
    }

    
    krcToArc(args) {
        const krcText = String(args.KRC_TEXT || "");
        try {
            const arc = { type: "krc", lyric: {} };
            krcText.split('\n').filter(line => line.trim() !== '').forEach((line, i) => {
                const parsed = this._parseKrcLine(line);
                if (!parsed) return;
                arc.lyric[i + 1] = parsed.words.map(word => ({
                    text: word.text,
                    o: word.absoluteTime !== undefined ? word.absoluteTime : parsed.startTime,
                    d: word.duration
                }));
            });
            return JSON.stringify(arc);
        } catch (error) {
            console.error('KRC转arc错误:', error);
            return '转换失败，请检查KRC格式';
        }
    }

    
    qrcToArc(args) {
        try {
            const arc = { type: "krc", lyric: {} };
            this._qrcLines(args.QRC_TEXT).forEach((line, i) => {
                if (line.words.length === 0) return;
                arc.lyric[i + 1] = line.words.map(word => ({
                    text: word.text,
                    o: word.absoluteTime,
                    d: word.duration
                }));
            });
            return JSON.stringify(arc);
        } catch (error) {
            console.error('QRC转arc错误:', error);
            return '转换失败，请检查QRC格式';
        }
    }

    
    yrcToWordTtmlWithAll(args) {
        const yrcText = String(args.YRC_TEXT || "");
        const translatedLrc = String(args.TRANSLATED_LRC || "");
        const romajiLrc = String(args.ROMAJI_LRC || "");
        
        try {
            
            const yrcLines = yrcText.split('\n').filter(line => line.trim() !== '');
            const parsedLines = [];
            
            for (const line of yrcLines) {
                const parsed = this._parseYrcLine(line);
                if (parsed && !this._isMetaText(parsed.words.map(word => word.text).join(''))) parsedLines.push(parsed);
            }
            
            
            const translationLines = this._parseLrc(translatedLrc).filter(line => !line.isMeta);
            const romajiLines = this._parseLrc(romajiLrc).filter(line => !line.isMeta);
            
            return this._generateWordByWordTtmlWithAll(parsedLines, translationLines, romajiLines);
        } catch (error) {
            console.error('YRC逐字转换错误:', error);
            return '转换失败: ' + error.message;
        }
    }

    
    krcToWordTtmlWithAll(args) {
        const krcText = String(args.KRC_TEXT || "");
        const translatedLrc = String(args.TRANSLATED_LRC || "");
        const romajiLrc = String(args.ROMAJI_LRC || "");
        
        try {
            
            const krcLines = krcText.split('\n').filter(line => line.trim() !== '');
            const parsedLines = [];
            
            for (const line of krcLines) {
                const parsed = this._parseKrcLine(line);
                if (parsed && !this._isMetaText(parsed.words.map(word => word.text).join(''))) parsedLines.push(parsed);
            }
            
            
            const translationLines = this._parseLrc(translatedLrc).filter(line => !line.isMeta);
            const romajiLines = this._parseLrc(romajiLrc).filter(line => !line.isMeta);
            
            return this._generateWordByWordTtmlWithAll(parsedLines, translationLines, romajiLines);
        } catch (error) {
            console.error('KRC逐字转换错误:', error);
            return '转换失败: ' + error.message;
        }
    }

    

    qrcToWordTtmlWithAll(args) {
        const qrcText = String(args.QRC_TEXT || "");
        const translatedLrc = String(args.TRANSLATED_LRC || "");
        const romajiLrc = String(args.ROMAJI_LRC || "");
        
        try {
            
            const qrcContent = this._extractQrcContent(qrcText);
            
            
            const qrcLines = qrcContent.split('\n').filter(line => line.trim() !== '');
            const parsedLines = [];
            
            for (const line of qrcLines) {
                const parsed = this._parseQrcLine(line);
                if (parsed && !this._isMetaText(parsed.words.map(word => word.text).join(''))) parsedLines.push(parsed);
            }
            
            this._expandCharLevelWords(parsedLines);
            
            
            const translationLines = this._parseLrcForQrc(translatedLrc);
            const romajiLines = this._parseLrcForQrc(romajiLrc);
            
            return this._generateWordByWordTtmlWithAll(parsedLines, translationLines, romajiLines);
        } catch (error) {
            console.error('QRC逐字转换错误:', error);
            return '转换失败: ' + error.message;
        }
    }

    
    _extractQrcContent(text) {
        const trimmed = text.trim();
        if (!trimmed) return text;
        
        
        if (/^\[ti:/.test(trimmed) || /^\[\d+,\d+\]/.test(trimmed)) {
            return text;
        }
        
        
        if (trimmed.includes('LyricContent="')) {
            const startIdx = trimmed.indexOf('LyricContent="') + 'LyricContent="'.length;
            
            const endPatterns = [
                '"/>\n</LyricInfo>\n</QrcInfos>',
                '"/>\n</LyricInfo>\n</QrcInfos>\n',
                '"/>',
                '"'
            ];
            for (const pattern of endPatterns) {
                const endIdx = trimmed.indexOf(pattern, startIdx);
                if (endIdx !== -1) {
                    const content = trimmed.substring(startIdx, endIdx);
                    return this._decodeXmlEntities(content);
                }
            }
        }
        
        
        const cdataMatch = trimmed.match(/<LyricContent><!\[CDATA\[([\s\S]*?)\]\]><\/LyricContent>/);
        if (cdataMatch) {
            return cdataMatch[1];
        }
        const tagMatch = trimmed.match(/<LyricContent>([\s\S]*?)<\/LyricContent>/);
        if (tagMatch) {
            return this._decodeXmlEntities(tagMatch[1].trim());
        }
        
        return text;
    }

    
    _decodeXmlEntities(text) {
        return text
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, '&');
    }

    
    _parseLrcForQrc(lrcText) {
        const lines = this._parseLrc(lrcText);
        return lines.filter(line => {
            const text = line.text.trim();
            
            if (text === '//' || text.startsWith('//')) return false;
            
            if (/^(QQ音乐|TME)/.test(text)) return false;
            return !line.isMeta;
        });
    }

    
    
    _expandCharLevelWords(parsedLines) {
        for (const line of parsedLines) {
            if (line.words.length === 0 && line.rawText) {
                const text = line.rawText;
                const lineDuration = line.duration > 0 ? line.duration : 3000;
                const charCount = Math.max(text.length, 1);
                const charDuration = lineDuration / charCount;
                
                line.words = [];
                for (let j = 0; j < text.length; j++) {
                    const char = text[j];
                    
                    if (char.trim() !== '') {
                        line.words.push({
                            absoluteTime: line.startTime + Math.floor(j * charDuration),
                            duration: Math.ceil(charDuration),
                            text: char,
                            offset: Math.floor(j * charDuration)
                        });
                    }
                }
            }
        }
    }

    
    _isMetaText(text) {
        return /^(?:作词|作曲|编曲|制作人|混音|母带|监制|和声|吉他|贝斯|鼓手|录音|滚动歌词贡献者|翻译歌词贡献者)\s*[:：]/.test(String(text || '').trim());
    }

    _parseLrc(lrcText) {
        const lines = lrcText.split('\n');
        const result = [];
        const metaSeen = new Set();
        const metaKey = (text) => String(text || '').replace(/\s+/g, ' ').trim().replace(/：/g, ':').replace(/\s*:\s*/g, ':').toLocaleLowerCase();
        const isMeta = (text) => this._isMetaText(text);
        
        for (const line of lines) {
            const lineTrimmed = line.trim();
            if (!lineTrimmed) continue;
            
            
            const timePrefix = lineTrimmed.match(/^((?:\[\d+:\d+(?:[.:]\d+)?\]\s*)+)/);
            const timeMatches = timePrefix ? [...timePrefix[1].matchAll(/\[(\d+):(\d+)(?:[.:](\d+))?\]/g)] : [];
            const timeMatch2 = lineTrimmed.match(/^\[(\d+),(\d+)\]/);
            const addLine = (totalMs, text) => {
                if (isMeta(text)) {
                    const key = metaKey(text);
                    if (key && metaSeen.has(key)) return;
                    if (key) metaSeen.add(key);
                }
                result.push({
                    time: totalMs,
                    text: text,
                    isMeta: isMeta(text)
                });
            };

            if (timeMatches.length > 0) {
                const last = timeMatches[timeMatches.length - 1];
                const text = lineTrimmed.slice(timePrefix[1].length).trim();
                timeMatches.forEach(match => {
                    const minutes = parseInt(match[1]);
                    const seconds = parseInt(match[2]);
                    const frac = match[3] ? parseFloat("0." + match[3]) : 0;
                    addLine((minutes * 60 + seconds) * 1000 + Math.round(frac * 1000), text);
                });
            } else if (timeMatch2) {
                addLine(parseInt(timeMatch2[1]), lineTrimmed.replace(/^\[\d+,\d+\]/, '').trim());
            }
        }
        
        
        result.sort((a, b) => a.time - b.time);
        return result;
    }

    _parseKrcLine(line) {
        let lineMatch = line.match(/^\[(\d+),(\d+)\](.*)/);
        let hasLineDuration = true;
        
        if (!lineMatch) {
            lineMatch = line.match(/^\[(\d+)\](.*)/);
            hasLineDuration = false;
        }
        
        if (!lineMatch) return null;
        
        const startTime = parseInt(lineMatch[1]);
        let duration = 0;
        let wordSection = "";
        
        if (hasLineDuration) {
            duration = parseInt(lineMatch[2]);
            wordSection = lineMatch[3];
        } else {
            wordSection = lineMatch[2];
        }
        
        const wordMatches = [...wordSection.matchAll(/<(\d+),(\d+)(?:,\d+)?>([\s\S]*?)(?=<\d+,\d+(?:,\d+)?>(?:.|$)|$)/g)];
        const words = wordMatches.map(match => {
            const offset = parseInt(match[1]);
            const wordDuration = parseInt(match[2]);
            const text = match[3];
            
            if (!hasLineDuration) {
                duration = Math.max(duration, offset + wordDuration);
            }
            
            return {
                offset: offset,
                duration: wordDuration,
                text: text,
                absoluteTime: startTime + offset
            };
        });
        
        
        if (words.length === 0 && wordSection.trim()) {
            words.push({
                offset: 0,
                duration: duration || 3000,
                text: wordSection,
                absoluteTime: startTime
            });
        }
        
        return { startTime, duration, words };
    }

    _parseYrcLine(line) {
        let lineMatch = line.match(/^\[(\d+),(\d+)\](.*)/);
        let hasLineDuration = true;
        
        if (!lineMatch) {
            lineMatch = line.match(/^\[(\d+)\](.*)/);
            hasLineDuration = false;
        }
        
        if (!lineMatch) return null;
        
        const startTime = parseInt(lineMatch[1]);
        let duration = 0;
        let wordSection = "";
        
        if (hasLineDuration) {
            duration = parseInt(lineMatch[2]);
            wordSection = lineMatch[3];
        } else {
            wordSection = lineMatch[2];
        }
        
        const wordMatches = [...wordSection.matchAll(/\((\d+),(\d+)(?:,\d+)?\)([\s\S]*?)(?=\(\d+,\d+(?:,\d+)?\)(?:.|$)|$)/g)];
        const words = wordMatches.map(match => {
            const absoluteTime = parseInt(match[1]);
            const wordDuration = parseInt(match[2]);
            const text = match[3];
            
            if (!hasLineDuration) {
                duration = Math.max(duration, absoluteTime - startTime + wordDuration);
            }
            
            return {
                absoluteTime: absoluteTime,
                duration: wordDuration,
                text: text,
                offset: absoluteTime - startTime
            };
        });
        
        
        if (words.length === 0 && wordSection.trim()) {
            words.push({
                absoluteTime: startTime,
                duration: duration || 3000,
                text: wordSection,
                offset: 0
            });
        }
        
        return { startTime, duration, words };
    }

    
    _parseQrcLine(line) {
        const lineTrimmed = line.trim();
        if (!lineTrimmed) return null;
        
        
        if (/^\[(lyric|trans)\]$/i.test(lineTrimmed)) return null;
        
        if (/^\[(ti|ar|al|by|offset|kana|roma|trans)[:\]]/i.test(lineTrimmed)) return null;
        
        
        let lineMatch = line.match(/^\[(\d+),(\d+)\](.*)/);
        let hasLineDuration = true;
        
        if (!lineMatch) {
            
            lineMatch = line.match(/^\[(\d+)\](.*)/);
            hasLineDuration = false;
        }
        
        if (!lineMatch) return null;
        
        const startTime = parseInt(lineMatch[1]);
        let duration = 0;
        let wordSection = "";
        
        if (hasLineDuration) {
            duration = parseInt(lineMatch[2]);
            wordSection = lineMatch[3];
        } else {
            wordSection = lineMatch[2];
        }
        
        
        const cleanText = wordSection.replace(/\(\s*\d+\s*,\s*\d+\s*\)/g, '').trim();
        if (cleanText === '') return null; 

        const words = [];
        const markerRe = /\(\s*(\d+)\s*,\s*(\d+)\s*\)/g;
        const markers = [...wordSection.matchAll(markerRe)];
        const addWord = (marker, text) => {
            if (text === '') return;
            const absoluteTime = parseInt(marker[1]);
            const wordDuration = parseInt(marker[2]);
            if (!hasLineDuration) duration = Math.max(duration, absoluteTime - startTime + wordDuration);
            words.push({
                absoluteTime: absoluteTime,
                duration: wordDuration,
                text: text,
                offset: absoluteTime - startTime
            });
        };
        if (markers.length > 0) {
            const markerAfterText = wordSection.slice(0, markers[0].index).trim() !== '';
            markers.forEach((marker, index) => {
                const textStart = markerAfterText
                    ? (index > 0 ? markers[index - 1].index + markers[index - 1][0].length : 0)
                    : marker.index + marker[0].length;
                const textEnd = markerAfterText
                    ? marker.index
                    : (index + 1 < markers.length ? markers[index + 1].index : wordSection.length);
                addWord(marker, wordSection.slice(textStart, textEnd));
            });
        } else if (wordSection.trim()) {
            words.push({ absoluteTime: startTime, duration: duration || 3000, text: wordSection, offset: 0 });
        }
        
        
        return { startTime, duration, words, rawText: cleanText };
    }

    _convertKrcLineToYrc(krcLine) {
        const parsed = this._parseKrcLine(krcLine);
        if (!parsed) return null;
        
        let yrcLine = `[${parsed.startTime}${parsed.duration > 0 ? `,${parsed.duration}` : ''}]`;
        
        for (const word of parsed.words) {
            const absoluteTime = parsed.startTime + word.offset;
            yrcLine += `(${absoluteTime},${word.duration},0)${word.text}`;
        }
        
        return yrcLine;
    }

    _convertYrcLineToKrc(yrcLine) {
        const parsed = this._parseYrcLine(yrcLine);
        if (!parsed) return null;
        
        let krcLine = `[${parsed.startTime}${parsed.duration > 0 ? `,${parsed.duration}` : ''}]`;
        
        for (const word of parsed.words) {
            const offset = word.absoluteTime - parsed.startTime;
            krcLine += `<${offset},${word.duration},0>${word.text}`;
        }
        
        return krcLine;
    }

    _formatLrcTime(ms) {
        const totalSeconds = ms / 1000;
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = Math.floor(totalSeconds % 60);
        const hundredths = Math.floor((ms % 1000) / 10);
        
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${hundredths.toString().padStart(2, '0')}`;
    }

    _generateWordByWordTtmlWithAll(originalLines, translationLines, romajiLines) {
        if (originalLines.length === 0) {
            return '<?xml version="1.0" encoding="UTF-8"?><tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word" xml:space="preserve"></tt>';
        }

        
        let totalDuration = 0;
        for (const line of originalLines) {
            const lineEnd = line.startTime + line.duration;
            if (lineEnd > totalDuration) {
                totalDuration = lineEnd;
            }
        }
        totalDuration += 5000;
        
        
        let ttml = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" itunes:timing="Word" xml:space="preserve">
    <head>
        <metadata>
            <ttm:agent type="person" xml:id="v1"/>
        </metadata>
    </head>
    <body dur="${this._formatTime(totalDuration)}">
        <div xmlns="" begin="00:00.000" end="${this._formatTime(totalDuration)}">`;

        
        const usedRomaji = new Set();
        const usedTranslations = new Set();
        
        
        originalLines.forEach((line, lineIndex) => {
            const lineStart = line.startTime;
            let lineEnd = line.startTime + line.duration;
            
            
            let maxWordEnd = lineStart;
            line.words.forEach(word => {
                const wordEnd = word.absoluteTime + word.duration;
                if (wordEnd > maxWordEnd) maxWordEnd = wordEnd;
            });
            
            const actualLineEnd = Math.max(lineEnd, maxWordEnd);
            
            
            
            let romaji = null;
            let bestRomaDiff = Infinity;
            let romaIndex = -1;
            
            for (let i = 0; i < romajiLines.length; i++) {
                if (usedRomaji.has(i)) continue;
                
                const diff = Math.abs(romajiLines[i].time - lineStart);
                if (diff < 500 && diff < bestRomaDiff) {
                    bestRomaDiff = diff;
                    romaji = romajiLines[i];
                    romaIndex = i;
                }
            }
            
            ttml += `<p begin="${this._formatTime(lineStart)}" end="${this._formatTime(actualLineEnd)}" ttm:agent="v1" itunes:key="L${lineIndex + 1}">`;
            
            
            if (line.words && line.words.length > 0) {
                line.words.forEach((word, wordIndex) => {
                    const wordStart = word.absoluteTime;
                    let wordEnd = wordStart + word.duration;
                    
                    if (wordEnd <= wordStart) {
                        const nw = line.words[wordIndex + 1];
                        wordEnd = nw ? Math.max(nw.absoluteTime, wordStart + 1) : Math.max(actualLineEnd, wordStart + 1);
                    }
                    ttml += `<span begin="${this._formatTime(wordStart)}" end="${this._formatTime(wordEnd)}">${this._escapeXml(word.text)}</span>`;
                });
            } else {
                
                ttml += `<span begin="${this._formatTime(lineStart)}" end="${this._formatTime(actualLineEnd)}">${this._escapeXml(line.words[0]?.text || '')}</span>`;
            }
            
            if (romaji) {
                ttml += `<span ttm:role="x-roman">${this._escapeXml(romaji.text)}</span>`;
                usedRomaji.add(romaIndex);
            }

            let translation = null;
            let bestTranslationDiff = Infinity;
            let translationIndex = -1;
            for (let i = 0; i < translationLines.length; i++) {
                if (usedTranslations.has(i)) continue;
                const diff = Math.abs(translationLines[i].time - lineStart);
                if (diff < 500 && diff < bestTranslationDiff) {
                    bestTranslationDiff = diff;
                    translation = translationLines[i];
                    translationIndex = i;
                }
            }
            if (translation) {
                ttml += `<span ttm:role="x-translation" xml:lang="zh-CN">${this._escapeXml(translation.text)}</span>`;
                usedTranslations.add(translationIndex);
            }
            
            ttml += `</p>`;
        });

        ttml += `</div>
    </body>
</tt>`;

        return ttml;
    }

    _formatTime(ms) {
        ms = Number(ms);
        if (!Number.isFinite(ms)) ms = 0;
        ms = Math.max(0, ms);
        const totalSeconds = ms / 1000;
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes.toString().padStart(2, '0')}:${seconds.toFixed(3).padStart(6, '0')}`;
    }

    _escapeXml(text) {
        if (typeof text !== 'string') return '';
        return text.replace(/[<>&'"]/g, char => {
            switch (char) {
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '&': return '&amp;';
                case '\'': return '&apos;';
                case '"': return '&quot;';
                default: return char;
            }
        });
    }
}

if (typeof window !== 'undefined') window.TtmlTools = new TtmlTools();
