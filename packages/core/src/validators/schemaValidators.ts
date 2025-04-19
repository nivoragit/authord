import Ajv from 'ajv';
import { InstanceProfile, AuthordConfig } from '../types';
import FileService from '../services/FileService';
 

export async function writersideSchemaValidator(schemaPath: string, ihpData:any, instances:InstanceProfile[], fileService: FileService): Promise<void> {
    const ajv = new Ajv({ allErrors: true });
    const rawSchema = await fileService.readFileAsString(schemaPath);
    const schema = JSON.parse(rawSchema);

    const ihp = ihpData?.ihp;
    const topicsDir = ihp?.topics?.['@_dir'] || 'topics';
    let imagesObj: any;
    if (ihp?.images) {
      imagesObj = {
        dir: ihp.images['@_dir'],
        version: ihp.images['@_version'],
        'web-path': ihp.images['@_web-path'],
      };
    }

    const configJson = {
      schema: ihpData?.schema,
      title: ihpData?.title,
      type: ihpData?.type,
      topics: { dir: topicsDir },
      images: imagesObj,
      instances: instances.map((inst) => ({
        id: inst.id,
        name: inst.name,
        'start-page': inst['start-page'],
        'toc-elements': inst['toc-elements'].map((te) => ({
          topic: te.topic,
          title: te.title,
          children: te.children,
        })),
      })),
    };

    const validate = ajv.compile(schema);
    if (!validate(configJson)) {
      throw new Error(
        `Schema validation failed: ${JSON.stringify(validate.errors, null, 2)}`
      );
    }
  }

export async function authortdSchemaValidator(schemaPath: string, configData:AuthordConfig, fileService: FileService): Promise<void> {
    if (!configData) {
      throw new Error('No configuration data available for schema validation.');
    }
    const ajv = new Ajv({ allErrors: true });
    const schemaData = await fileService.readFileAsString(schemaPath);
    const schema = JSON.parse(schemaData);

    const validate = ajv.compile(schema);
    const valid = validate(configData);
    if (!valid) {
      const errors = validate.errors || [];
      throw new Error(
        `Schema validation failed: ${JSON.stringify(errors, null, 2)}`
      );
    }

  }