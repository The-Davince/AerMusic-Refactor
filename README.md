# AerMusic
**实用、舒服，NO LIMIT**. 本项目使用AI辅助开发

### 项目特点
- 支持SMTC，并对ttml类型的歌词做了一点特别的SMTC适配
- 支持ttml、krc、lrc 三种类型的歌词渲染。不过有的会转为特殊的格式，yrc也是.
- 美丽的动画. ~~一点也不美丽，好像有点丝滑。不要怀疑是否在用你的设备挖矿~~
- **根据你的听歌喜好来自动推荐歌曲**
- 美妙的我

### 在线预览
前往 [AerMusic https://music.aermini.top](https://music.aermini.top) 在线访问本项目.

### 食用方法
- PC端只需要用鼠标在空白处上下滚动即可切歌，或按下键盘上的“↑”“↓”键.
- 移动端先受着吧，还没考虑做适配。但是这个项目重构之前做过一次移动端适配，后来没再管了。移动端的切歌方式为直接上下滑动，可以像刷抖音一样
- PC端点击歌曲封面可以切换歌词的显示/隐藏；移动端点击歌曲封面切换到歌词页，点击空白处返回
- “空格键” 暂停/播放
- 不想全写。你自己摸索吧，，


### 部署
1. git下来
2. 复制 `.env.example` 为 `.env`
3. 填 `.env`
4. 安装依赖. 在项目根目录执行 `pip install -r requirements.txt`
5. 启动项目. 在项目根目录执行 `python run.py`

当然，如果你使用redis，则需要额外安装依赖. 在项目根目录执行 `pip install redis>=5.0` 或 `pip install -r requirements-optional.txt`

差不多就部署完了。然后你就能开始愉快的使用了，，

### 推荐上游服务
| 类型 | URL | 描述 |
| ---- | -- | ---- |
| 歌词 | https://api.music.aermini.top/tr/lyric | 这是作者自己的歌词服务, 本地歌词库+amll歌词库+网易云歌词库. 可见下方[歌词服务](#歌词服务) |
| 网易云API | https://163.aermini.top | NodeJS版ncmAPI. v4.32.0 |

额其实我也没啥好推荐的，毕竟我也不怎么用别人的，也不敢保证别人的API一定适合这个项目。也许对于更低版本的NodeJS版网易云API，你需要改动这个项目的源码来对接口做一些适配。但最好还是使用 >=4.32.0 的版本

### 歌词服务
上面的表格提到了这个服务。鉴于还没写文档，所以在这里简单说明一下用法.
```txt
https://api.music.aermini.top/tr/lyric?id={歌曲ID}&platform={平台ID}
```
额其实直接请求这个url就行了，就是这么简单.

实际上不用带`platform`参数，该参数默认值为ncm(网易云). 不过目前还没实现不同平台的id互转，这肯定是要靠人工录入的。现在入库的map简直是少之又少。下面是 `platform` 参数值对照

| 平台ID | 对应平台 |
| ----- | -------- |
| ncm | 网易云音乐 |
| qqm | QQ音乐 |
| qsm | 汽水音乐 |
| kwm | 酷我音乐 |
| kgm | 酷狗音乐 |
| joox | JOOX |
| mgm | 咪咕音乐 |
| cam | AerMusic (嗯对，这是我们自己的曲库) |

目前看来，这api也就只能服务于网易云了。因为数据实在是太少了，然后还没做其他平台的适配。有空会搞上

返回示例 ([https://api.music.aermini.top/tr/lyric?id=1827600686](https://api.music.aermini.top/tr/lyric?id=1827600686))
```json
{
  "code": 200,
  "message": "success",
  "id": "1827600686", // 歌曲ID
  "task": 107, // 入库时绑定的baseID. 可以忽略这个值. 它的作用实际上就是让不同平台对应的ID绑定到这份歌词
  "platform": "ncm", // 平台ID
  "t": 1791832517279, // 入库时间. 可以忽略这个值
  "now": 1791840818492, // 当前时间
  "from": "local", // 来源. 可以忽略这个值
  "lyricist": "h3R3", // 入库时保存的作词
  "composition": "h3R3", // 入库时保存的作曲
  "yrc": { // YRC格式歌词
    "version": 1, // 迭代版本
    "author": "AerMini", // 贡献者
    "lyric": "[15127,2215](15127,345,0)还(15472,200,0)是(15672,360,0)会(16032,560,0)想(16592,750,0)你\n[18001,2471]( ..."  // 歌词内容
  },
  "lrc": { // LRC格式歌词 但是网易云版 这里不多解释
    "version": 31,
    "author": "",
    "lyric": "{\"t\":0,\"c\":[{\"tx\":\"作词: \"},{\"tx\":\"林达浪\",\"li\":\"http://p1.music.126.net/ZnC ..."
  },
  "ttml": { // TTML格式歌词. 建议使用它
    "version": 1,
    "author": "AerMini",
    "lyric": "\u003Ctt xmlns=\"http://www.w3.org/ns/ttml\" xmlns:itunes=\"http://music.apple.com/lyric-ttml-internal\" xmlns:ttm=\"http://www ..."
  },
  "tlyric": { // 翻译歌词.
    "version": 0, // ver0代表无数据 或者检查lyric是否为空
    "author": "",
    "lyric": ""
  },
  "ytlyric": { // 网易云针对yrc的翻译歌词吧 有可能是因为原先tlyric时间轴跟已有yrc歌词对不上 所以搞一个这个出来. 当yrc存在时，还是推荐优先使用ytlyric作为翻译歌词.
    "version": 0,
    "author": "",
    "lyric": ""
  }
}
```

### 关于作者
额，都写到这了。留几个链接或者联系方式.
- QQ: 2092369184
- 邮箱: aermini@163.com
- 个人站: https://aermini.top
- 全网都叫 AerMini

大概就是这样。没事不要来打扰我. 我不希望出现在任何无关的场合

额，要是被函了我将以超越光速的速度进行一个删库跑路