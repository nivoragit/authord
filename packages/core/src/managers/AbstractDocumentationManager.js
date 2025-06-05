"use strict";
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
// eslint-disable-next-line import/no-unresolved
// import * as vscode from 'vscode';
var path = require("path");
var AbstractDocumentationManager = /** @class */ (function () {
    function AbstractDocumentationManager(configPath, notifier, fileService) {
        this.instances = [];
        this.configPath = configPath;
        this.notifier = notifier;
        this.fileService = fileService;
    }
    AbstractDocumentationManager.prototype.getInstances = function () {
        return this.instances;
    };
    /**
     * Renames a topic’s file on disk and updates config accordingly.
     */
    AbstractDocumentationManager.prototype.moveTopic = function (oldTopicFile, newTopicFile, doc) {
        return __awaiter(this, void 0, void 0, function () {
            var topicsDir, oldPath, newPath;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        topicsDir = this.getTopicsDirectory();
                        oldPath = path.join(topicsDir, oldTopicFile);
                        newPath = path.join(topicsDir, newTopicFile);
                        this.fileService.rename(oldPath, newPath);
                        return [4 /*yield*/, this.saveInstance(doc)];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Deletes one or more topic files -> removes from disk -> updates .tree/config.
     */
    AbstractDocumentationManager.prototype.removeTopics = function (topicsFilestoBeRemoved, doc) {
        return __awaiter(this, void 0, void 0, function () {
            var topicsDir;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        topicsDir = this.getTopicsDirectory();
                        return [4 /*yield*/, Promise.all(topicsFilestoBeRemoved.map(function (tFile) { return __awaiter(_this, void 0, void 0, function () { return __generator(this, function (_a) {
                                return [2 /*return*/, this.fileService.deleteFileIfExists(path.join(topicsDir, tFile))];
                            }); }); }))];
                    case 1:
                        _a.sent();
                        return [4 /*yield*/, this.saveInstance(doc)];
                    case 2:
                        _a.sent();
                        return [2 /*return*/, true];
                }
            });
        });
    };
    /**
     * Adds a new child topic (and file) -> updates config if file is created.
     */
    AbstractDocumentationManager.prototype.createChildTopic = function (newTopic, doc) {
        return __awaiter(this, void 0, void 0, function () {
            var filePath, fileExists;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.createMarkdownFile(newTopic)];
                    case 1:
                        filePath = _a.sent();
                        return [4 /*yield*/, this.fileService.fileExists(path.join(this.getTopicsDirectory(), newTopic.topic))];
                    case 2:
                        fileExists = _a.sent();
                        if (!fileExists) return [3 /*break*/, 4];
                        return [4 /*yield*/, this.saveInstance(doc)];
                    case 3:
                        _a.sent();
                        _a.label = 4;
                    case 4: return [2 /*return*/, filePath];
                }
            });
        });
    };
    /**
     * Retrieves the title from a Markdown file’s first heading or uses fallback.
     */
    AbstractDocumentationManager.prototype.extractMarkdownTitle = function (topicFile) {
        return __awaiter(this, void 0, void 0, function () {
            var mdFilePath, content, lines, i, line, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 2, , 3]);
                        mdFilePath = path.join(this.getTopicsDirectory(), topicFile);
                        return [4 /*yield*/, this.fileService.readFileAsString(mdFilePath)];
                    case 1:
                        content = _b.sent();
                        lines = content.split('\n');
                        for (i = 0; i < lines.length; i += 1) {
                            line = lines[i].trim();
                            if (line.startsWith('# ')) {
                                return [2 /*return*/, line.substring(1).trim()];
                            }
                            if (line.length > 0) {
                                break;
                            }
                        }
                        return [3 /*break*/, 3];
                    case 2:
                        _a = _b.sent();
                        return [3 /*break*/, 3];
                    case 3: return [2 /*return*/, "<".concat(path.basename(topicFile), ">")];
                }
            });
        });
    };
    AbstractDocumentationManager.prototype.setTopicTitle = function (topicFile, newTitle) {
        return __awaiter(this, void 0, void 0, function () {
            var mdFilePath;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        mdFilePath = path.join(this.getTopicsDirectory(), topicFile);
                        return [4 /*yield*/, this.fileService.updateFile(mdFilePath, function (content) {
                                var lines = content.split('\n');
                                for (var i = 0; i < lines.length; i += 1) {
                                    if (lines[i].trim().startsWith('# ')) {
                                        lines[i] = "# ".concat(newTitle);
                                        return lines.join('\n');
                                    }
                                    if (lines[i].trim().length > 0)
                                        break;
                                }
                                // No title found, prepend it
                                return "# ".concat(newTitle, "\n").concat(content);
                            })];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Writes a new .md file for the topic, if it doesn’t exist.
     */
    AbstractDocumentationManager.prototype.createMarkdownFile = function (newTopic) {
        return __awaiter(this, void 0, void 0, function () {
            var topicsDir, filePath, err_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 4, , 5]);
                        topicsDir = this.getTopicsDirectory();
                        return [4 /*yield*/, this.fileService.createDirectory(topicsDir)];
                    case 1:
                        _a.sent();
                        filePath = path.join(topicsDir, newTopic.topic);
                        return [4 /*yield*/, this.fileService.fileExists(filePath)];
                    case 2:
                        if (_a.sent()) {
                            this.notifier.showWarningMessage("Topic file \"".concat(newTopic.topic, "\" already exists."));
                            return [2 /*return*/, ""];
                        }
                        return [4 /*yield*/, this.fileService.writeNewFile(filePath, "# ".concat(newTopic.title, "\n\nContent goes here..."))];
                    case 3:
                        _a.sent();
                        return [2 /*return*/, filePath];
                    case 4:
                        err_1 = _a.sent();
                        this.notifier.showErrorMessage("Failed to write topic file \"".concat(newTopic.topic, "\": ").concat(err_1.message));
                        throw err_1;
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    return AbstractDocumentationManager;
}());
exports.default = AbstractDocumentationManager;
