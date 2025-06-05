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
/* eslint-disable no-param-reassign, no-useless-constructor, @typescript-eslint/no-unused-vars */
var path = require("path");
var AbstractDocumentationManager_1 = require("./AbstractDocumentationManager");
var AuthordDocumentManager = /** @class */ (function (_super) {
    __extends(AuthordDocumentManager, _super);
    function AuthordDocumentManager(configPath, notifier, fileService) {
        return _super.call(this, configPath, notifier, fileService) || this;
    }
    AuthordDocumentManager.prototype.reload = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a;
            var _this = this;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _a = this;
                        return [4 /*yield*/, this.parseConfigFile()];
                    case 1:
                        _a.configData = _b.sent();
                        if (!this.configData) {
                            return [2 /*return*/];
                        }
                        if (!this.configData.instances) return [3 /*break*/, 3];
                        // Load titles from each topic’s .md file
                        return [4 /*yield*/, Promise.all(this.configData.instances.map(function (inst) { return __awaiter(_this, void 0, void 0, function () {
                                var _this = this;
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0: return [4 /*yield*/, Promise.all(inst['toc-elements'].map(function (element) { return __awaiter(_this, void 0, void 0, function () {
                                                var _a;
                                                return __generator(this, function (_b) {
                                                    switch (_b.label) {
                                                        case 0:
                                                            if (!element.topic) return [3 /*break*/, 2];
                                                            _a = element;
                                                            return [4 /*yield*/, this.extractMarkdownTitle(element.topic)];
                                                        case 1:
                                                            _a.title = _b.sent();
                                                            _b.label = 2;
                                                        case 2: return [2 /*return*/];
                                                    }
                                                });
                                            }); }))];
                                        case 1:
                                            _a.sent();
                                            return [2 /*return*/];
                                    }
                                });
                            }); }))];
                    case 2:
                        // Load titles from each topic’s .md file
                        _b.sent();
                        _b.label = 3;
                    case 3:
                        this.instances = this.configData.instances || [];
                        return [2 /*return*/];
                }
            });
        });
    };
    AuthordDocumentManager.prototype.initializeConfigurationFile = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        this.configData = AuthordDocumentManager.defaultConfigJson();
                        return [4 /*yield*/, this.fileService.writeNewFile(this.configPath, '{}')];
                    case 1:
                        _a.sent();
                        return [4 /*yield*/, this.saveConfigurationFile()];
                    case 2:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    AuthordDocumentManager.defaultConfigJson = function () {
        return {
            schema: 'https://json-schema.org/draft/2020-12/schema',
            title: 'Authord Settings',
            type: 'object',
            topics: { dir: 'topics' },
            images: { dir: 'images', version: '1.0', 'web-path': 'images' },
            instances: [],
        };
    };
    AuthordDocumentManager.prototype.parseConfigFile = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.fileService.fileExists(this.configPath)];
                    case 1:
                        if (!(_a.sent())) {
                            return [2 /*return*/, undefined];
                        }
                        return [2 /*return*/, this.fileService.readJsonFile(this.configPath)];
                }
            });
        });
    };
    AuthordDocumentManager.prototype.saveConfigurationFile = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.configData) {
                            return [2 /*return*/];
                        }
                        return [4 /*yield*/, this.fileService.updateJsonFile(this.configPath, function () { return _this.configData; })];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    AuthordDocumentManager.prototype.getTopicsDirectory = function () {
        var _a, _b;
        return path.join(path.dirname(this.configPath), ((_b = (_a = this.configData) === null || _a === void 0 ? void 0 : _a.topics) === null || _b === void 0 ? void 0 : _b.dir) || 'topics');
    };
    AuthordDocumentManager.prototype.getImagesDirectory = function () {
        var _a, _b;
        return path.join(path.dirname(this.configPath), ((_b = (_a = this.configData) === null || _a === void 0 ? void 0 : _a.images) === null || _b === void 0 ? void 0 : _b.dir) || 'images');
    };
    AuthordDocumentManager.prototype.createInstance = function (newDocument) {
        return __awaiter(this, void 0, void 0, function () {
            var title, markdownFileExists, i;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.configData) {
                            return [2 /*return*/];
                        }
                        this.instances.push(newDocument);
                        title = newDocument['toc-elements'][0].title;
                        return [4 /*yield*/, this.createMarkdownFile(newDocument['toc-elements'][0])];
                    case 1:
                        markdownFileExists = _a.sent();
                        i = 2;
                        _a.label = 2;
                    case 2:
                        if (!!markdownFileExists) return [3 /*break*/, 4];
                        newDocument['toc-elements'][0].title = "".concat(title, " ").concat(i);
                        return [4 /*yield*/, this.createMarkdownFile(newDocument['toc-elements'][0])];
                    case 3:
                        markdownFileExists = _a.sent();
                        i += 1;
                        return [3 /*break*/, 2];
                    case 4:
                        this.configData.instances = this.instances;
                        return [4 /*yield*/, this.saveConfigurationFile()];
                    case 5:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    AuthordDocumentManager.prototype.removeInstance = function (docId, allTopics) {
        return __awaiter(this, void 0, void 0, function () {
            var foundDoc, topicsDir;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        foundDoc = this.instances.find(function (d) { return d.id === docId; });
                        if (!foundDoc || !this.configData) {
                            return [2 /*return*/, false];
                        }
                        topicsDir = this.getTopicsDirectory();
                        return [4 /*yield*/, Promise.all(allTopics.map(function (topicFileName) { return __awaiter(_this, void 0, void 0, function () {
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0: return [4 /*yield*/, this.fileService.deleteFileIfExists(path.join(topicsDir, topicFileName))];
                                        case 1:
                                            _a.sent();
                                            return [2 /*return*/];
                                    }
                                });
                            }); }))];
                    case 1:
                        _a.sent();
                        this.instances = this.instances.filter(function (doc) { return doc.id !== docId; });
                        this.configData.instances = this.instances;
                        return [4 /*yield*/, this.saveConfigurationFile()];
                    case 2:
                        _a.sent();
                        return [2 /*return*/, true];
                }
            });
        });
    };
    AuthordDocumentManager.prototype.saveInstance = function (doc, _filePath) {
        return __awaiter(this, void 0, void 0, function () {
            var existingIndex;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.configData) {
                            return [2 /*return*/];
                        }
                        existingIndex = this.instances.findIndex(function (d) { return d.id === doc.id; });
                        if (existingIndex >= 0) {
                            this.instances[existingIndex] = doc;
                        }
                        else {
                            this.instances.push(doc);
                        }
                        // Persist to config file
                        this.configData.instances = this.instances;
                        return [4 /*yield*/, this.saveConfigurationFile()];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    return AuthordDocumentManager;
}(AbstractDocumentationManager_1.default));
exports.default = AuthordDocumentManager;
