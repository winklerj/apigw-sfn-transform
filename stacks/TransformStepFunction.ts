import { Stack, StackContext, use, Function } from "sst/constructs";
import { SimpleTable } from "./Table";
import { DynamoAttributeValue, DynamoGetItem, LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { JsonPath, LogLevel, Pass, Result, StateMachine, StateMachineType } from "aws-cdk-lib/aws-stepfunctions";
import { LogGroup } from "aws-cdk-lib/aws-logs";

export function TransformStepFunction({ stack }: StackContext) {
    const table = use(SimpleTable);
    return getStateMachine(stack, table);
}

function getHttpFunction(stack: Stack) {
    return new Function(stack, 'call-http-api-function', {
		handler: 'packages/functions/src/call-http-api.handler',
	});
}
function getStateMachine(stack: Stack, table: any) {
    // This retrieves the record from the table and returns the config needed to make the request.
    const getItem = new DynamoGetItem(stack, 'Get Item', {
        table: table.cdk.table,
        key: {
            pk: DynamoAttributeValue.fromString(JsonPath.stringAt('$.querystring.env')),
            sk: DynamoAttributeValue.fromString('METADATA#'),
        },
		resultSelector: {
			'baseURL.$': '$.Item.data.M.url.S',
			headers: {
				'Authorization.$': 'States.Format(\'Bearer {}\', $.Item.data.M.token.S)',
			},
		},
		resultPath: '$.config',
    });

    // This task is to pass config into the lambda function to log some additional data. 
    // It allows you to turn on debug logging without having to redeploy the lambda function.
    const enableLogTask = new Pass(stack, 'pass-config-state', {
		result: Result.fromBoolean(true),
		resultPath: '$.enableLog'
	});

    // Transform previous data into an axios config object: https://axios-http.com/docs/req_config.
    // This allows the lambda to stay generic and reusable for any type of request.
	const transformQueryParams = new Pass(stack, 'transform-query-params', {
		parameters: {
			'params': JsonPath.objectAt('$.querystring'),
			'url': JsonPath.stringAt('States.Format(\'/api/v1{}\',$.requestContext.resourcePath)'),
			'method': JsonPath.stringAt('$.requestContext.httpMethod'),
			'baseURL': JsonPath.stringAt('$.config.baseURL'),
			headers: {
				'Authorization': JsonPath.stringAt('$.config.headers.Authorization'),
			},
			'data': JsonPath.objectAt('$.body'),
		},
		resultPath: '$.config',
	});

	const httpRequest = new LambdaInvoke(stack, 'call-http-api', {
		lambdaFunction: getHttpFunction(stack),
		outputPath: '$.Payload.response',
	});

	const httpFailureTransformer = new Pass(stack, 'http-failure-transformer', {
		parameters: {
			cause: JsonPath.objectAt('States.StringToJson($.Cause)'),
			status: '$.status',
		}
	});
	const httpTimeoutError = new Pass(stack, 'http-failure-timeout-error', {
		parameters: {
			statusCode: 504,
			errorMessage: 'Proxied endpoint did not respond in a timely manner',
		},
	});
	const parseFailure = new Pass(stack, 'http-failure-parse-failure', {
		parameters: {
			errorMessage: JsonPath.objectAt('States.StringToJson($.cause.errorMessage)'),
		}
	});
	const separateFailureStatusCode = new Pass(stack, 'http-failure-separate-failure-status-code', {
		parameters: {
			statusCode: JsonPath.objectAt('$.errorMessage.statusCode'),
			errors: JsonPath.objectAt('$.errorMessage.errors'),
		}
	});
	httpFailureTransformer.next(parseFailure).next(separateFailureStatusCode);
	httpRequest.addCatch(httpTimeoutError, {
		errors: ['States.Timeout', 'Lambda.Unknown'],
	});
	httpRequest.addCatch(httpFailureTransformer);

	const logGroup = new LogGroup(stack, 'Http-Client-State-Machine-Log-Group')
	const stateMachine = new StateMachine(stack, 'Http-Client-State-Machine', {
		definition: getItem.next(enableLogTask).next(transformQueryParams).next(httpRequest),
		stateMachineType: StateMachineType.EXPRESS,
		logs: {
			destination: logGroup,
			level: LogLevel.ALL,
			includeExecutionData: true,
		},
		tracingEnabled: true,
	});
    return stateMachine;
}
