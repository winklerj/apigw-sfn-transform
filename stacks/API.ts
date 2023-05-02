import { AccessLogFormat, LogGroupLogDestination, RestApi, StepFunctionsIntegration, StepFunctionsRestApi, StepFunctionsRestApiProps } from "aws-cdk-lib/aws-apigateway";
import { StackContext, use } from "sst/constructs";
import { StepFunction } from "./StepFunction";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { TransformStepFunction } from "./TransformStepFunction";

export function API({ stack }: StackContext) {
  const stateMachine = use(StepFunction);
  const transformStateMachine = use(TransformStepFunction);
  const apiLogGroup = new LogGroup(stack, 'Api-Gateway-Log-Group');

  const apiProps: StepFunctionsRestApiProps = {
    stateMachine,
    querystring: true,
    path: true,
    headers: true,
    requestContext: {
      httpMethod: true,
    },
    deployOptions: {
      accessLogDestination: new LogGroupLogDestination(apiLogGroup),
      accessLogFormat: AccessLogFormat.jsonWithStandardFields(),
    },
  }

  const defaultIntegration = StepFunctionsIntegration.startExecution(stateMachine, {
    credentialsRole: apiProps.role,
    requestContext: apiProps.requestContext,
    path: apiProps.path ?? true,
    querystring: apiProps.querystring ?? true,
    headers: apiProps.headers,
    authorizer: apiProps.authorizer,
  });
  const restApi = new RestApi(stack, "restApi", {
    defaultIntegration,
    deployOptions: {
      accessLogDestination: new LogGroupLogDestination(apiLogGroup),
      accessLogFormat: AccessLogFormat.jsonWithStandardFields(),
    },
  });
  const envRes = restApi.root.addResource('environments');
  envRes.addMethod('ANY');
  envRes.addResource('{id}').addMethod('ANY');

  // Add http state maching route
  const contactRes = restApi.root.addResource('contacts')
  contactRes.addMethod('ANY', StepFunctionsIntegration.startExecution(transformStateMachine, {
    requestContext: {
      httpMethod: true,
      resourcePath: true,
    },
    path: true,
    querystring: true,
    headers: true,
  }), {
    requestParameters: {
      'method.request.querystring.env': true,
    },
    requestValidatorOptions: {
      validateRequestParameters: true,
    },

  });
  stack.addOutputs({
    ApiEndpoint: restApi.url,
  });
  return restApi;
}
