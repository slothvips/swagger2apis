/**
 * 转换层：负责将JSON数据整理成方便模板渲染的数据结构
 */

import { chineseCharacter2pinyin, removeSpecialCharacter } from "./utils";
import { JavaType2JavaScriptType } from "./dict";
import { IContext } from "./app";

export interface ApiInfo {
  tags: string[];
  path: string;
  method: string;
  description: string;
  parameters: ParameterInfo[];
  response: ResponseInfo;
  responseType?: string;
}

export interface ParameterInfo {
  name: string;
  description: string;
  type: string;
  required: boolean;
  position: "path" | "query" | "body" | "formData" | "header";
}

export interface ResponseInfo {
  description: string;
  type: string;
}

export interface InterfaceInfo {
  name: string;
  description: string;
  properties: PropertyInfo[];
  rawProperties: any;
}

export interface PropertyInfo {
  name: string;
  description: string;
  type: string;
  required: boolean;
}

// 主转换函数
export function transform(ctx: IContext) {
  const { paths, definitions } = ctx.rawJSON;
  const apis = generateApis(paths);
  const interfaces = generateInterfaces(definitions, apis);
  return {
    apis,
    interfaces,
    raw: ctx.rawJSON
  };
}

// 生成API信息
function generateApis(paths: any): ApiInfo[] {
  return Object.entries(paths).flatMap(([path, pathData]: [string, any]) => {
    return Object.entries(pathData).map(([method, methodData]: [string, any]): ApiInfo => {
      const parameters = generateParameters(methodData.parameters);
      const response = generateResponse(methodData.responses);
      return {
        tags: methodData.tags,
        path,
        method,
        description: methodData.description || methodData.summary || "",
        parameters,
        response
      };
    });
  });
}

// 生成参数信息
function generateParameters(parameters: any[]): ParameterInfo[] {
  if (!parameters) return [];
  const result = parameters
    .filter((param) => ["path", "query", "body", "formData"].includes(param.in))
    .map((param) => ({
      name: param.name,
      description: param.description || "",
      type: param.type || getSchemaType(param.schema),
      required: param.required || false,
      position: param.in
    }));
  return result;
}
const responsesInterfacesSet = new Set();
// 生成响应信息
function generateResponse(responses: any): ResponseInfo {
  const okResponse = responses["200"];
  const type = okResponse?.schema ? getSchemaType(okResponse.schema) : "";
  responsesInterfacesSet.add(type);
  return {
    description: okResponse?.description || "",
    type
  };
}

// 根据refName获取ts中的interface名称
const getTypeName = (refName: string) => {
  return `I${chineseCharacter2pinyin(removeSpecialCharacter(refName))}`;
};
// 获取schema类型
function getSchemaType(schema: any, cover: any = {}): string {
  const _schema = {
    ...(schema || {}),
    ...(cover || {})
  };

  if (_schema.$ref) {
    const refName = _schema.$ref.split("/definitions/").pop();
    return getTypeName(refName);
  }

  // 处理map等特殊类型
  if (_schema.additionalProperties) {
    if (_schema.additionalProperties.type === "array") {
      // 对于前端来说,后端的map其实就是一个对象,所以这里该用Record来标记类型
      return `Record<string,${getSchemaType(_schema.additionalProperties, { $ref: _schema.additionalProperties.items.$ref })}>`;
      // return `Map<string,${getSchemaType(_schema.additionalProperties, { $ref: _schema.additionalProperties.items.$ref })}>`;
    }
    return `object`;
  }

  if (_schema.type === "array") {
    const itemsRefName = _schema.items.$ref?.split("/definitions/").pop() || "";
    const match = itemsRefName.match(/Map«(.+),(.+)»/);
    if (match) {
      const [, keyType, valueType] = match;
      return `Record<${JavaType2JavaScriptType[keyType] || keyType},${JavaType2JavaScriptType[valueType] || valueType}>`;
    }
    return `${getSchemaType(_schema.items)}[]`;
  }

  return JavaType2JavaScriptType[_schema.type];
}

// 生成ts interface信息
const generateInterfaces = function (definitions: any, apis: ApiInfo[]): InterfaceInfo[] {
  generateInterfaces.responseInterfacesDeep.clear();

  const interfaces = Object.entries(definitions)
    .map(([name, def]: [string, any]): InterfaceInfo | boolean => {
      // TODO: 排除无用的Map类型定义, 比如Map<string,object>,下边的逻辑有bug,多出无用接口也无伤大雅,所以暂时注释掉不予处理
      // if (name.match(/Map«(.+),(.+)»/)) return false;

      const interfaceName = getTypeName(name);

      // 因为有些后端只喜欢定义入参是否必须,那么索性将响应属性全部设置为必须:方案为查找当前接口是否出现在响应中,如果出现在响应中则深度属性全部设置为required
      // 如果接口出现在响应中，将所有属性设置为必需
      let requiredProps = def.required || [];
      // 检查接口是否出现在响应中
      const isInResponse = apis.some((api) => {
        return api.response.type === interfaceName;
      });
      if (isInResponse) {
        generateInterfaces.responseInterfacesDeep.add(interfaceName);
        requiredProps = ["in-response"];
      }

      return {
        name: interfaceName,
        description: def.description || "",
        properties: generateProperties(def.properties, requiredProps),
        rawProperties: def.properties
      };
    })
    .filter(Boolean) as InterfaceInfo[];

  const finalInterfaces = interfaces.map((itf) => {
    if (generateInterfaces.responseInterfacesDeep.has(itf.name)) {
      return {
        ...itf,
        properties: generateProperties(itf.rawProperties, ["in-response"])
      };
    } else {
      return itf;
    }
  });

  return finalInterfaces;
};
generateInterfaces.responseInterfacesDeep = new Set();

// 生成属性信息
function generateProperties(properties: any, requiredProps: string[]): PropertyInfo[] {
  if (!properties) return [];
  return Object.entries(properties).map(([name, prop]: [string, any]): PropertyInfo => {
    const type = getSchemaType(prop);

    const inResponese = requiredProps[0] === "in-response";

    inResponese && generateInterfaces.responseInterfacesDeep.add(removeSpecialCharacter(type));

    return {
      name,
      type,
      description: prop.description || "没有提供描述",
      required: inResponese || requiredProps.includes(name)
    };
  });
}

export default transform;
