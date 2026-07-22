
import { _util, createDecorator } from '@/platform/instantiation/common/instantiation.js';
import { SyncDescriptor } from '@/platform/instantiation/common/descriptors.js';
import { InstantiationService } from '../common/instantiationService';
import { ServiceCollection } from '../common/serviceCollection';




export const IFirstService = createDecorator('IFirstService');


interface IFirstService {
  readonly _serviceBrand: undefined;
  doSomething(): void;
}


export class FirstService implements IFirstService {
  declare readonly _serviceBrand: undefined;

  doSomething(): void {
    console.log('FirstService doing something');
  }

}



export function deprecated(_target: any, key: string, descriptor: any): void {

  if (typeof descriptor.value !== 'function') {
    throw new Error('not supported');
  }

  const fn = descriptor.value;
  descriptor.value = function () {
    console.warn(`Git extension API method '${key}' is deprecated.`);
    return fn.apply(this, arguments);
  };
}

const ITestService = createDecorator('ITestService');

interface ITestService {
  readonly _serviceBrand: undefined;
  testMethod(): void;
}

class TestClass implements ITestService {
  _serviceBrand: undefined;
  testMethod(): void {
    throw new Error('Method not implemented.');
  }

  constructor(@IFirstService private readonly firstService: IFirstService) {

    console.log("TestClass constructor called");
  }


  @deprecated
  public TestDecorator(value: string): Promise<boolean> {

    console.log("test the Decorator:", value);
    this.firstService.doSomething();
    return Promise.resolve(true);
  }

}





export function testDecorator(): void {
  const services = new ServiceCollection();
  services.set(IFirstService, new SyncDescriptor(FirstService));
  const instantiationService = new InstantiationService(services, false, undefined, false);
  const testInstance = instantiationService.createInstance(TestClass);
  testInstance.TestDecorator("testing success");
}
