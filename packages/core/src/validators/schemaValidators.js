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
exports.writersideSchemaValidator = writersideSchemaValidator;
exports.authortdSchemaValidator = authortdSchemaValidator;
var ajv_1 = require("ajv");
function writersideSchemaValidator(schemaPath, ihpData, instances, fileService) {
    return __awaiter(this, void 0, void 0, function () {
        var ajv, rawSchema, schema, ihp, topicsDir, imagesObj, configJson, validate;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    ajv = new ajv_1.default({ allErrors: true });
                    return [4 /*yield*/, fileService.readFileAsString(schemaPath)];
                case 1:
                    rawSchema = _b.sent();
                    schema = JSON.parse(rawSchema);
                    ihp = ihpData === null || ihpData === void 0 ? void 0 : ihpData.ihp;
                    topicsDir = (_a = ihp === null || ihp === void 0 ? void 0 : ihp.topics) === null || _a === void 0 ? void 0 : _a['@_dir'];
                    if (!topicsDir) {
                        throw new Error('Schema validation failed: topics dir not available');
                    }
                    if (ihp === null || ihp === void 0 ? void 0 : ihp.images) {
                        imagesObj = {
                            dir: ihp.images['@_dir'],
                            version: ihp.images['@_version'],
                            'web-path': ihp.images['@_web-path'],
                        };
                    }
                    else {
                        throw new Error('Schema validation failed: images dir not available');
                    }
                    configJson = {
                        schema: ihpData === null || ihpData === void 0 ? void 0 : ihpData.schema,
                        title: ihpData === null || ihpData === void 0 ? void 0 : ihpData.title,
                        type: ihpData === null || ihpData === void 0 ? void 0 : ihpData.type,
                        topics: { dir: topicsDir },
                        images: imagesObj,
                        instances: instances.map(function (inst) { return ({
                            id: inst.id,
                            name: inst.name,
                            'start-page': inst['start-page'],
                            'toc-elements': inst['toc-elements'].map(function (te) { return ({
                                topic: te.topic,
                                title: te.title,
                                children: te.children,
                            }); }),
                        }); }),
                    };
                    validate = ajv.compile(schema);
                    if (!validate(configJson)) {
                        throw new Error("Schema validation failed: ".concat(JSON.stringify(validate.errors, null, 2)));
                    }
                    return [2 /*return*/];
            }
        });
    });
}
function authortdSchemaValidator(schemaPath, configData, fileService) {
    return __awaiter(this, void 0, void 0, function () {
        var ajv, schemaData, schema, validate, valid, errors;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!configData) {
                        throw new Error('No configuration data available for schema validation.');
                    }
                    ajv = new ajv_1.default({ allErrors: true });
                    return [4 /*yield*/, fileService.readFileAsString(schemaPath)];
                case 1:
                    schemaData = _a.sent();
                    schema = JSON.parse(schemaData);
                    validate = ajv.compile(schema);
                    valid = validate(configData);
                    if (!valid) {
                        errors = validate.errors || [];
                        throw new Error("Schema validation failed: ".concat(JSON.stringify(errors, null, 2)));
                    }
                    return [2 /*return*/];
            }
        });
    });
}
