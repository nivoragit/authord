"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable no-useless-constructor, no-continue, prefer-destructuring */
var path = require("path");
var fast_xml_parser_1 = require("fast-xml-parser");
var AbstractFileService_1 = require("../services/AbstractFileService");
var AbstractDocumentationManager_1 = require("./AbstractDocumentationManager");
var WriterSideDocumentManager = /** @class */ (function (_super) {
    __extends(WriterSideDocumentManager, _super);
    function WriterSideDocumentManager(configPath, notifier, fileService) {
        return _super.call(this, configPath, notifier, fileService) || this;
    }
    WriterSideDocumentManager.prototype.reload = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _a = this;
                        return [4 /*yield*/, this.readIhpFile()];
                    case 1:
                        _a.ihpData = _b.sent();
                        return [4 /*yield*/, this.loadAllInstances()];
                    case 2:
                        _b.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    WriterSideDocumentManager.prototype.getIhpDir = function () {
        return path.dirname(this.configPath);
    };
    WriterSideDocumentManager.prototype.getTopicsDirectory = function () {
        var _a;
        var ihp = (_a = this.ihpData) === null || _a === void 0 ? void 0 : _a.ihp;
        return path.join(this.getIhpDir(), (ihp === null || ihp === void 0 ? void 0 : ihp.topics) && ihp.topics['@_dir'] ? ihp.topics['@_dir'] : 'topics');
    };
    WriterSideDocumentManager.prototype.getImagesDirectory = function () {
        var _a;
        var ihp = (_a = this.ihpData) === null || _a === void 0 ? void 0 : _a.ihp;
        return path.join(this.getIhpDir(), (ihp === null || ihp === void 0 ? void 0 : ihp.images) && ihp.images['@_dir'] ? ihp.images['@_dir'] : 'images');
    };
    WriterSideDocumentManager.prototype.readIhpFile = function () {
        return __awaiter(this, void 0, void 0, function () {
            var fileExists, defaultIhp, raw;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.fileService.fileExists(this.configPath)];
                    case 1:
                        fileExists = _a.sent();
                        if (!!fileExists) return [3 /*break*/, 3];
                        defaultIhp = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<ihp version=\"2.0\">\n  <topics dir=\"topics\"/>\n</ihp>";
                        return [4 /*yield*/, this.fileService.writeNewFile(this.configPath, defaultIhp)];
                    case 2:
                        _a.sent();
                        _a.label = 3;
                    case 3: return [4 /*yield*/, this.fileService.readFileAsString(this.configPath)];
                    case 4:
                        raw = _a.sent();
                        return [2 /*return*/, AbstractFileService_1.default.parseXmlString(raw)];
                }
            });
        });
    };
    WriterSideDocumentManager.prototype.writeIhpFile = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.fileService.updateXmlFile(this.configPath, function () { return _this.ihpData; })];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    WriterSideDocumentManager.prototype.loadAllInstances = function () {
        return __awaiter(this, void 0, void 0, function () {
            var ihp, instances, instanceProfiles, validProfiles;
            var _this = this;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        ihp = (_a = this.ihpData) === null || _a === void 0 ? void 0 : _a.ihp;
                        instances = [];
                        if (Array.isArray(ihp === null || ihp === void 0 ? void 0 : ihp.instance)) {
                            instances = ihp.instance;
                        }
                        else if (ihp === null || ihp === void 0 ? void 0 : ihp.instance) {
                            instances = [ihp.instance];
                        }
                        if (instances.length === 0) {
                            this.instances = [];
                            return [2 /*return*/, this.instances];
                        }
                        return [4 /*yield*/, Promise.all(instances.map(function (inst) { return __awaiter(_this, void 0, void 0, function () {
                                var treeFile;
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0:
                                            if (!inst['@_src']) {
                                                return [2 /*return*/, null];
                                            }
                                            treeFile = path.join(this.getIhpDir(), inst['@_src']);
                                            return [4 /*yield*/, this.fileService.fileExists(treeFile)];
                                        case 1:
                                            if (!(_a.sent())) {
                                                return [2 /*return*/, null];
                                            }
                                            return [2 /*return*/, this.parseInstanceProfile(treeFile)];
                                    }
                                });
                            }); }))];
                    case 1:
                        instanceProfiles = _b.sent();
                        validProfiles = instanceProfiles.filter(function (profile) { return profile !== null; });
                        this.instances = validProfiles;
                        return [2 /*return*/, this.instances];
                }
            });
        });
    };
    WriterSideDocumentManager.prototype.parseInstanceProfile = function (treeFile) {
        return __awaiter(this, void 0, void 0, function () {
            var raw, data, profile, docId, name, startPage, tocElements;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.fileService.readFileAsString(treeFile)];
                    case 1:
                        raw = _a.sent();
                        data = AbstractFileService_1.default.parseXmlString(raw);
                        profile = data['instance-profile'];
                        if (!profile) {
                            return [2 /*return*/, null];
                        }
                        docId = profile['@_id'];
                        name = profile['@_name'] || profile['@_id'] || 'Untitled';
                        startPage = profile['@_start-page'] || '';
                        return [4 /*yield*/, this.buildTocElements(profile['toc-element'] || [])];
                    case 2:
                        tocElements = _a.sent();
                        return [2 /*return*/, {
                                filePath: treeFile,
                                id: docId,
                                name: name,
                                'start-page': startPage,
                                'toc-elements': tocElements
                            }];
                }
            });
        });
    };
    /**
     * This is the most efficient approach to gather titles (parallel reading).
     */
    WriterSideDocumentManager.prototype.buildTocElements = function (originalXmlElements) {
        return __awaiter(this, void 0, void 0, function () {
            var xmlElements, tasks;
            var _this = this;
            return __generator(this, function (_a) {
                xmlElements = originalXmlElements;
                if (!Array.isArray(xmlElements)) {
                    xmlElements = xmlElements ? [xmlElements] : [];
                }
                tasks = xmlElements.map(function (elem) { return __awaiter(_this, void 0, void 0, function () {
                    var topicFile, children, mdTitle;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                topicFile = elem['@_topic'];
                                return [4 /*yield*/, this.buildTocElements(elem['toc-element'] || [])];
                            case 1:
                                children = _a.sent();
                                return [4 /*yield*/, this.extractMarkdownTitle(topicFile)];
                            case 2:
                                mdTitle = _a.sent();
                                return [2 /*return*/, {
                                        topic: topicFile,
                                        title: mdTitle,
                                        sortChildren: 'none',
                                        children: children
                                    }];
                        }
                    });
                }); });
                return [2 /*return*/, Promise.all(tasks)];
            });
        });
    };
    WriterSideDocumentManager.prototype.saveInstance = function (doc) {
        return __awaiter(this, void 0, void 0, function () {
            var filePath, startPage, profileObj, xmlContent, doctype, fullContent;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        filePath = doc.filePath;
                        startPage = doc['toc-elements'].length === 1 ? doc['toc-elements'][0].topic : doc['start-page'];
                        profileObj = {
                            'instance-profile': {
                                '@_id': doc.id,
                                '@_name': doc.name,
                                '@_start-page': startPage,
                                'toc-element': this.createXmlTocNodes(doc['toc-elements'])
                            }
                        };
                        return [4 /*yield*/, this.convertToXmlString(profileObj)];
                    case 1:
                        xmlContent = _a.sent();
                        doctype = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE instance-profile SYSTEM \"https://resources.jetbrains.com/writerside/1.0/product-profile.dtd\">\n\n";
                        fullContent = doctype + xmlContent;
                        return [4 /*yield*/, this.fileService.writeNewFile(filePath, fullContent)];
                    case 2:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    WriterSideDocumentManager.prototype.convertToXmlString = function (profileObj) {
        return __awaiter(this, void 0, void 0, function () {
            var builder, _a;
            var _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        _a = fast_xml_parser_1.XMLBuilder.bind;
                        _b = {
                            ignoreAttributes: false,
                            format: true
                        };
                        return [4 /*yield*/, this.fileService.getIndentationSetting()];
                    case 1:
                        builder = new (_a.apply(fast_xml_parser_1.XMLBuilder, [void 0, (_b.indentBy = _c.sent(),
                                _b.suppressEmptyNode = true,
                                _b)]))();
                        return [2 /*return*/, builder.build(profileObj)];
                }
            });
        });
    };
    WriterSideDocumentManager.prototype.createXmlTocNodes = function (elements) {
        var _this = this;
        return elements.map(function (e) {
            var node = { '@_topic': e.topic };
            if (e.children && e.children.length > 0) {
                node['toc-element'] = _this.createXmlTocNodes(e.children);
            }
            return node;
        });
    };
    WriterSideDocumentManager.prototype.createInstance = function (newDocument) {
        return __awaiter(this, void 0, void 0, function () {
            var treeFileName, title, markdownFileExists, i;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        treeFileName = "".concat(newDocument.id, ".tree");
                        newDocument.filePath = path.join(path.dirname(this.configPath), treeFileName);
                        return [4 /*yield*/, this.saveInstance(newDocument)];
                    case 1:
                        _a.sent();
                        if (!this.ihpData.ihp.instance) {
                            this.ihpData.ihp.instance = [];
                        }
                        else if (!Array.isArray(this.ihpData.ihp.instance)) {
                            this.ihpData.ihp.instance = [this.ihpData.ihp.instance];
                        }
                        this.ihpData.ihp.instance.push({ '@_src': treeFileName });
                        return [4 /*yield*/, this.writeIhpFile()];
                    case 2:
                        _a.sent();
                        this.instances.push(newDocument);
                        title = newDocument['toc-elements'][0].title;
                        return [4 /*yield*/, this.createMarkdownFile(newDocument['toc-elements'][0])];
                    case 3:
                        markdownFileExists = _a.sent();
                        i = 2;
                        _a.label = 4;
                    case 4:
                        if (!!markdownFileExists) return [3 /*break*/, 6];
                        newDocument['toc-elements'][0].title = "".concat(title, " ").concat(i);
                        return [4 /*yield*/, this.createMarkdownFile(newDocument['toc-elements'][0])];
                    case 5:
                        markdownFileExists = _a.sent();
                        i += 1;
                        return [3 /*break*/, 4];
                    case 6: return [2 /*return*/];
                }
            });
        });
    };
    WriterSideDocumentManager.prototype.removeInstance = function (docId, allTopics) {
        return __awaiter(this, void 0, void 0, function () {
            var ihp, arr, idx, treeSrc, doc, topicsDir_1, treeFilePath;
            var _this = this;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        ihp = (_a = this.ihpData) === null || _a === void 0 ? void 0 : _a.ihp;
                        if (!ihp.instance) {
                            return [2 /*return*/, false];
                        }
                        arr = Array.isArray(ihp.instance) ? ihp.instance : [ihp.instance];
                        return [4 /*yield*/, this.locateDocumentIndex(arr, docId)];
                    case 1:
                        idx = _b.sent();
                        if (!(idx > -1)) return [3 /*break*/, 6];
                        treeSrc = arr[idx]['@_src'];
                        doc = this.instances.find(function (d) { return d.id === docId; });
                        if (!doc) return [3 /*break*/, 3];
                        topicsDir_1 = this.getTopicsDirectory();
                        return [4 /*yield*/, Promise.all(allTopics.map(function (tFile) { return __awaiter(_this, void 0, void 0, function () {
                                var p;
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0:
                                            p = path.join(topicsDir_1, tFile);
                                            return [4 /*yield*/, this.fileService.deleteFileIfExists(p)];
                                        case 1:
                                            _a.sent();
                                            return [2 /*return*/];
                                    }
                                });
                            }); }))];
                    case 2:
                        _b.sent();
                        _b.label = 3;
                    case 3:
                        arr.splice(idx, 1);
                        if (arr.length === 1) {
                            ihp.instance = arr[0];
                        }
                        else {
                            ihp.instance = arr;
                        }
                        return [4 /*yield*/, this.writeIhpFile()];
                    case 4:
                        _b.sent();
                        treeFilePath = path.join(this.getIhpDir(), treeSrc);
                        return [4 /*yield*/, this.fileService.deleteFileIfExists(treeFilePath)];
                    case 5:
                        _b.sent();
                        this.instances = this.instances.filter(function (d) { return d.id !== docId; });
                        return [2 /*return*/, true];
                    case 6: return [2 /*return*/, false];
                }
            });
        });
    };
    WriterSideDocumentManager.prototype.locateDocumentIndex = function (instances, docId) {
        return __awaiter(this, void 0, void 0, function () {
            var i, src, treeFile, raw, data, profile;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        i = 0;
                        _a.label = 1;
                    case 1:
                        if (!(i < instances.length)) return [3 /*break*/, 5];
                        src = instances[i]['@_src'];
                        if (!src) {
                            return [3 /*break*/, 4];
                        }
                        treeFile = path.join(this.getIhpDir(), src);
                        return [4 /*yield*/, this.fileService.fileExists(treeFile)];
                    case 2:
                        if (!(_a.sent())) {
                            return [3 /*break*/, 4];
                        }
                        return [4 /*yield*/, this.fileService.readFileAsString(treeFile)];
                    case 3:
                        raw = _a.sent();
                        data = AbstractFileService_1.default.parseXmlString(raw);
                        profile = data['instance-profile'];
                        if (profile && profile['@_id'] === docId) {
                            return [2 /*return*/, i];
                        }
                        _a.label = 4;
                    case 4:
                        i += 1;
                        return [3 /*break*/, 1];
                    case 5: return [2 /*return*/, -1];
                }
            });
        });
    };
    return WriterSideDocumentManager;
}(AbstractDocumentationManager_1.default));
exports.default = WriterSideDocumentManager;
